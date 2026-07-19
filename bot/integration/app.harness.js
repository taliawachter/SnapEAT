// Integration-test harness: an Express app exposing the SAME four routes
// defined in ../index.js, built from the SAME service/shared modules.
//
// WHY THIS FILE EXISTS INSTEAD OF IMPORTING ../index.js DIRECTLY:
// ../index.js is a combined Express server + WhatsApp (Baileys) bot. At
// module load time it unconditionally calls app.listen(...) and starts an
// infinite WhatsApp connect/retry loop (startBot(), retried via setTimeout
// on failure). Importing it in a test process would bind a real port and
// hang the test run forever. Extracting an exportable `createApp()` from
// index.js would fix this cleanly, but that is a change to production code
// structure and is out of scope for this testing-infrastructure task.
//
// MAINTENANCE NOTE: the route bodies below are intentionally a close
// mirror of ../index.js as of this work. If those routes change, update
// this file to match. Everything each route *calls* (meal-analysis
// service, shared normalizers, shared meal-edit validation) is the real,
// unmodified production module — only Firebase Admin, `firebase-admin/auth`,
// and the OpenAI client are swapped for fakes by the test file before this
// module is imported.
import path from "path";
import fs from "fs";
import os from "os";
import express from "express";
import cors from "cors";
import multer from "multer";
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firebase-admin.js";
import { analyzeMealImage } from "../services/meal-analysis.js";
import {
  canonicalAnalysisToLegacyText,
  normalizeMealAnalysis,
} from "../../shared/meal-analysis.js";
import {
  buildCanonicalMealUpdatePayload,
  extractBearerToken,
  validateMealEditDraft,
} from "../../shared/meal-edit.js";

function normalizeIngredientForStorage(item = {}) {
  const normalized = normalizeMealAnalysis({ ingredients: [item] }).ingredients[0];
  return {
    name: normalized.name,
    estimatedQuantity: normalized.estimatedQuantity,
    estimatedQuantityGrams: normalized.estimatedQuantityGrams,
    calories: normalized.calories,
    proteinGrams: normalized.proteinGrams,
    carbohydratesGrams: normalized.carbohydratesGrams,
    fatGrams: normalized.fatGrams,
    confidence: normalized.confidence,
    quantity: normalized.estimatedQuantity,
    grams: normalized.estimatedQuantityGrams,
    protein: normalized.proteinGrams,
    carbs: normalized.carbohydratesGrams,
    fat: normalized.fatGrams,
  };
}

function buildStoredMealEntry({
  mealType,
  mealName,
  imageUrl,
  analysis,
  date,
  source,
  mealNote = "",
  phone = undefined,
}) {
  const normalizedAnalysis = normalizeMealAnalysis({
    ...analysis,
    mealName: mealName || analysis?.mealName,
  });
  const normalizedIngredients = normalizedAnalysis.ingredients.map((item) =>
    normalizeIngredientForStorage(item)
  );

  const entry = {
    mealType,
    mealName: normalizedAnalysis.mealName,
    imageUrl: String(imageUrl || ""),
    ingredients: normalizedIngredients,
    totalCalories: normalizedAnalysis.totalCalories,
    totalEstimatedQuantityGrams: normalizedAnalysis.totalEstimatedQuantityGrams,
    analysis: {
      mealName: normalizedAnalysis.mealName,
      description: normalizedAnalysis.description,
      totalEstimatedQuantityGrams: normalizedAnalysis.totalEstimatedQuantityGrams,
      totalCalories: normalizedAnalysis.totalCalories,
      totalProteinGrams: normalizedAnalysis.totalProteinGrams,
      totalCarbohydratesGrams: normalizedAnalysis.totalCarbohydratesGrams,
      totalFatGrams: normalizedAnalysis.totalFatGrams,
      confidence: normalizedAnalysis.confidence,
      estimationNotes: normalizedAnalysis.estimationNotes,
      ingredients: normalizedIngredients,
      protein: normalizedAnalysis.totalProteinGrams,
      carbs: normalizedAnalysis.totalCarbohydratesGrams,
      fat: normalizedAnalysis.totalFatGrams,
    },
    analysisText: canonicalAnalysisToLegacyText(normalizedAnalysis),
    createdAt: date ? new Date(date) : new Date(),
    source,
  };

  if (mealNote) entry.mealNote = mealNote;
  if (phone) entry.phone = phone;
  if (normalizedAnalysis.totalProteinGrams != null) entry.protein = normalizedAnalysis.totalProteinGrams;
  if (normalizedAnalysis.totalCarbohydratesGrams != null) entry.carbs = normalizedAnalysis.totalCarbohydratesGrams;
  if (normalizedAnalysis.totalFatGrams != null) entry.fat = normalizedAnalysis.totalFatGrams;

  return entry;
}

async function getAuthenticatedUid(req) {
  const token = extractBearerToken(req.headers?.authorization || "");
  if (!token) return null;

  try {
    const decoded = await getAuth().verifyIdToken(token);
    return decoded?.uid || null;
  } catch {
    return null;
  }
}

function toExistingDateValue(value) {
  if (value?.toDate && typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date();
  return parsed;
}

function serializeTimestampForJson(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value?.toDate === "function") {
    const dateValue = value.toDate();
    if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
      return dateValue.toISOString();
    }
  }
  const seconds = Number(value?._seconds ?? value?.seconds);
  if (Number.isFinite(seconds)) {
    const nanos = Number(value?._nanoseconds ?? value?.nanoseconds ?? 0);
    const parsed = new Date(seconds * 1000 + Math.floor(nanos / 1e6));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
}

export function createTestApp() {
  const app = express();
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapeat-test-uploads-"));

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const extension = path.extname(file.originalname || "").toLowerCase() || ".jpg";
      const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(extension) ? extension : ".jpg";
      cb(null, `meal-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
    },
  });
  const upload = multer({ storage });

  app.use(express.json());
  app.use(cors());

  app.post("/api/meals/analyze", upload.single("mealImage"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Missing meal image" });
        return;
      }

      const imagePath = req.file.path;
      const imageUrl = `/uploads/meal-images/${req.file.filename}`;
      const analysis = await analyzeMealImage(imagePath);

      res.json({
        imageUrl,
        analysis: {
          mealName: analysis.mealName,
          description: analysis.description,
          totalEstimatedQuantityGrams: analysis.totalEstimatedQuantityGrams,
          ingredients: analysis.ingredients,
          totalCalories: analysis.totalCalories,
          totalProteinGrams: analysis.totalProteinGrams,
          totalCarbohydratesGrams: analysis.totalCarbohydratesGrams,
          totalFatGrams: analysis.totalFatGrams,
          confidence: analysis.confidence,
          estimationNotes: analysis.estimationNotes,
          protein: analysis.totalProteinGrams,
          carbs: analysis.totalCarbohydratesGrams,
          fat: analysis.totalFatGrams,
        },
      });
    } catch (error) {
      if (error?.code === "AI_NOT_CONFIGURED") {
        res.status(503).json({ error: "AI analysis is not configured" });
        return;
      }
      res.status(500).json({ error: "Failed to analyze meal image" });
    }
  });

  app.post("/api/diary/meals", async (req, res) => {
    try {
      const {
        userId,
        mealType,
        mealName,
        imageUrl,
        ingredients,
        totalCalories,
        protein,
        carbs,
        fat,
        date,
      } = req.body || {};

      if (!userId || !mealType || !mealName || !imageUrl || !Array.isArray(ingredients)) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const validMealTypes = ["breakfast", "lunch", "dinner", "snack"];
      if (!validMealTypes.includes(mealType)) {
        res.status(400).json({ error: "Invalid meal type" });
        return;
      }

      const entry = buildStoredMealEntry({
        mealType,
        mealName: String(mealName),
        imageUrl: String(imageUrl),
        analysis: {
          mealName: String(mealName),
          ingredients,
          totalCalories,
          totalProteinGrams: protein,
          totalCarbohydratesGrams: carbs,
          totalFatGrams: fat,
        },
        date,
        source: "app",
      });

      const savedDoc = await db.collection("users").doc(String(userId)).collection("meals").add(entry);

      res.status(201).json({ id: savedDoc.id, ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save meal in diary" });
    }
  });

  app.patch("/api/diary/meals/:mealId", async (req, res) => {
    try {
      const uid = await getAuthenticatedUid(req);
      if (!uid) {
        res.status(401).json({ error: "נדרשת התחברות כדי לערוך ארוחה.", code: "UNAUTHORIZED" });
        return;
      }

      const mealId = String(req.params?.mealId || "").trim();
      if (!mealId) {
        res.status(400).json({ error: "חסר מזהה ארוחה.", code: "MISSING_MEAL_ID" });
        return;
      }

      const validationResult = validateMealEditDraft(req.body || {});
      if (!validationResult.ok) {
        res.status(400).json({
          error: validationResult.errors[0] || "נתוני עריכה לא תקינים.",
          code: "INVALID_MEAL_PAYLOAD",
          details: validationResult.errors,
        });
        return;
      }

      const canonicalPayload = buildCanonicalMealUpdatePayload(validationResult.draft);
      const mealRef = db.collection("users").doc(uid).collection("meals").doc(mealId);
      const snapshot = await mealRef.get();

      if (!snapshot.exists) {
        res.status(404).json({ error: "הארוחה לא נמצאה.", code: "MEAL_NOT_FOUND" });
        return;
      }

      const existing = snapshot.data() || {};
      const rebuilt = buildStoredMealEntry({
        mealType: canonicalPayload.mealType,
        mealName: canonicalPayload.mealName,
        imageUrl: existing.imageUrl || "",
        analysis: {
          mealName: canonicalPayload.mealName,
          ingredients: canonicalPayload.ingredients,
          totalCalories: canonicalPayload.totalCalories,
          totalProteinGrams: canonicalPayload.totalProteinGrams,
          totalCarbohydratesGrams: canonicalPayload.totalCarbohydratesGrams,
          totalFatGrams: canonicalPayload.totalFatGrams,
          totalEstimatedQuantityGrams: canonicalPayload.totalEstimatedQuantityGrams,
        },
        date: toExistingDateValue(existing.createdAt),
        source: existing.source || "app",
        mealNote: existing.mealNote || "",
        phone: existing.phone,
      });

      const updatePayload = {
        mealType: rebuilt.mealType,
        mealName: rebuilt.mealName,
        ingredients: rebuilt.ingredients,
        totalCalories: rebuilt.totalCalories,
        totalEstimatedQuantityGrams: rebuilt.totalEstimatedQuantityGrams,
        analysis: rebuilt.analysis,
        analysisText: rebuilt.analysisText,
        protein: rebuilt.protein ?? null,
        carbs: rebuilt.carbs ?? null,
        fat: rebuilt.fat ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      };

      await mealRef.set(updatePayload, { merge: true });

      const updatedSnap = await mealRef.get();
      const updatedData = updatedSnap.data() || {};

      res.json({
        success: true,
        ok: true,
        id: mealId,
        meal: {
          id: mealId,
          ...updatedData,
          imageUrl: String(updatedData.imageUrl || existing.imageUrl || rebuilt.imageUrl || ""),
          createdAt: serializeTimestampForJson(updatedData.createdAt || existing.createdAt),
          updatedAt: serializeTimestampForJson(updatedData.updatedAt),
          source: updatedData.source || existing.source || "app",
        },
      });
    } catch (error) {
      res.status(500).json({ error: "עדכון הארוחה נכשל.", code: "PATCH_MEAL_FAILED" });
    }
  });

  app.get("/", (req, res) => {
    res.status(200).send("ok");
  });

  return app;
}
