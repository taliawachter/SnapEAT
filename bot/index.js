import "dotenv/config";
import { db, bucket } from "./firebase-admin.js";
import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import multer from "multer";
import makeWASocket, {
  Browsers,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import { analyzeMealImage } from "./services/meal-analysis.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =====================
// Config
// =====================
const PORT = Number(process.env.PORT || 3000);

function normalizePhone(value = "") {
  let phone = String(value);

  if (phone.endsWith("@s.whatsapp.net")) {
    phone = phone.replace("@s.whatsapp.net", "");
  }

  phone = phone.replace(/\D/g, "");

  if (phone.startsWith("0")) {
    phone = "972" + phone.slice(1);
  }

  return phone;
}

const BOT_NUMBER = normalizePhone(process.env.PAIRING_PHONE || "");

const ALLOWED_NUMBERS = new Set(
  (process.env.ALLOWED_CHATS || "")
    .split(",")
    .map((s) => normalizePhone(s))
    .filter(Boolean)
);

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let memoryServiceModule = null;
let didTryLoadMemoryService = false;

async function getMemoryService() {
  if (didTryLoadMemoryService) return memoryServiceModule;
  didTryLoadMemoryService = true;

  try {
    memoryServiceModule = await import("./services/memory.service.js");
  } catch (error) {
    memoryServiceModule = null;
    console.log("⚠️ Memory service unavailable:", error?.message || error);
  }

  return memoryServiceModule;
}

function parseAssistantJson(rawContent = "") {
  const text = String(rawContent || "").trim();
  if (!text) return null;

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) return null;

    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

const LONG_TERM_MEMORY_FIELDS = [
  "height",
  "weight",
  "goalWeight",
  "activityLevel",
  "dietPreferences",
  "allergies",
  "likedFoods",
  "dislikedFoods",
  "notes",
];

function sanitizeMemoryUpdate(memoryUpdate) {
  if (!memoryUpdate || typeof memoryUpdate !== "object" || Array.isArray(memoryUpdate)) {
    return null;
  }

  const filtered = {};

  for (const field of LONG_TERM_MEMORY_FIELDS) {
    const value = memoryUpdate[field];
    if (value === undefined) continue;

    if (field === "dietPreferences" || field === "allergies" || field === "likedFoods" || field === "dislikedFoods") {
      if (Array.isArray(value)) {
        filtered[field] = value
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .slice(0, 50);
      }
      continue;
    }

    if (field === "height" || field === "weight" || field === "goalWeight") {
      const num = Number(value);
      if (Number.isFinite(num)) filtered[field] = num;
      continue;
    }

    const asString = String(value || "").trim();
    if (asString) filtered[field] = asString;
  }

  return Object.keys(filtered).length ? filtered : null;
}

function formatRecentMessagesForPrompt(messages = []) {
  if (!Array.isArray(messages) || !messages.length) return "אין היסטוריית שיחה קודמת.";

  return messages
    .map((msg, index) => {
      const role = String(msg?.role || "user");
      const content = String(msg?.content || "");
      return `${index + 1}. ${role}: ${content}`;
    })
    .join("\n");
}

function formatUserMemoryForPrompt(userMemory) {
  if (!userMemory?.profile) return "אין זיכרון משתמש ארוך-טווח.";

  try {
    return JSON.stringify(userMemory.profile, null, 2);
  } catch {
    return "אין זיכרון משתמש ארוך-טווח.";
  }
}

function resolveSenderJid(msg) {
  const key = msg?.key || {};
  const remoteJid = String(key.remoteJid || "");
  const participant = String(key.participant || "");
  const participantAlt = String(
    key.participantAlt || key.participantPn || key.participantLid || msg?.participantAlt || ""
  );

  if (remoteJid.endsWith("@lid")) {
    if (participantAlt) return participantAlt;
    if (participant) return participant;
  }

  return remoteJid;
}

// =====================
// Storage
// =====================
const app = express();

const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const localUploadsRootDir = path.join(__dirname, "uploads");
const localMealImagesDir = path.join(localUploadsRootDir, "meal-images");
if (!fs.existsSync(localMealImagesDir)) {
  fs.mkdirSync(localMealImagesDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, localMealImagesDir);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(extension)
      ? extension
      : ".jpg";
    cb(null, `meal-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

const upload = multer({ storage });

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeIngredientForStorage(item = {}) {
  const name = String(item?.name || item?.foodName || item?.ingredientName || "רכיב");

  const quantityRaw =
    item?.quantity ??
    item?.amount ??
    (item?.grams !== null && item?.grams !== undefined && item?.grams !== ""
      ? `${item.grams} גרם`
      : undefined);

  const quantity = typeof quantityRaw === "string" && quantityRaw.trim()
    ? quantityRaw.trim()
    : "לא צוין";

  const calories = Number(item?.calories ?? item?.kcal ?? 0);
  const protein = Number(item?.protein ?? 0);
  const carbs = Number(item?.carbs ?? item?.carbohydrates ?? 0);
  const fat = Number(item?.fat ?? item?.fats ?? 0);

  return {
    name,
    quantity,
    calories: Number.isFinite(calories) ? calories : 0,
    protein: Number.isFinite(protein) ? protein : 0,
    carbs: Number.isFinite(carbs) ? carbs : 0,
    fat: Number.isFinite(fat) ? fat : 0,
  };
}

function formatAnalysisText({ mealName, ingredients, totalCalories, protein, carbs, fat }) {
  const ingredientLines = (ingredients || []).map((item) => {
    const ingredientName = String(item?.name || "רכיב");
    const quantity = String(item?.quantity || "לא צוין");
    const ingredientCalories = Number(item?.calories || 0);
    const ingredientCarbs = Number(item?.carbs || 0);
    const ingredientFat = Number(item?.fat || 0);
    const ingredientProtein = Number(item?.protein || 0);

    return `${ingredientName} | כמות: ${quantity} | פחמימות: ${ingredientCarbs} גרם | שומנים: ${ingredientFat} גרם | חלבונים: ${ingredientProtein} גרם | קלוריות: ${ingredientCalories} קל׳`;
  });

  const lines = [
    `זיהיתי: ${mealName}`,
    "",
    "רכיבים מפורטים:",
    ...ingredientLines,
    "",
    "קלוריות משוערות:",
    `הערכה סבירה: ${totalCalories}`,
    "",
    "מאקרו משוער:",
  ];

  if (protein !== undefined) lines.push(`חלבון: ${protein}`);
  if (carbs !== undefined) lines.push(`פחמימות: ${carbs}`);
  if (fat !== undefined) lines.push(`שומן: ${fat}`);

  lines.push(`סה״כ: ${totalCalories} קל׳`);

  return lines.join("\n");
}

function normalizeMealType(text = "") {
  const t = text.trim().toLowerCase();

  if (t === "בוקר" || t === "ארוחת בוקר") return "breakfast";
  if (t === "צהריים" || t === "ארוחת צהריים") return "lunch";
  if (t === "ערב" || t === "ארוחת ערב") return "dinner";
  if (t === "ביניים" || t === "ארוחת ביניים") return "snack";

  return null;
}

async function uploadMealImage(buffer, mimeType, phone) {
  const normalizedPhone = normalizePhone(phone);
  const extension = mimeType?.includes("png") ? "png" : "jpg";
  const fileName = `meal-images/${normalizedPhone}/${Date.now()}.${extension}`;
  const file = bucket.file(fileName);

  await file.save(buffer, {
    metadata: {
      contentType: mimeType || "image/jpeg",
    },
    resumable: false,
  });

  await file.makePublic();

  return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
}

async function getUserByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);

  console.log("🔍 מחפש משתמש לפי phone:", normalizedPhone);

  const snapshot = await db
    .collection("users")
    .where("phone", "==", normalizedPhone)
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.log("❌ לא נמצא משתמש עם phone:", normalizedPhone);
    return null;
  }

  return {
    id: snapshot.docs[0].id,
    ...snapshot.docs[0].data(),
  };
}

async function saveMealEntry({
  from,
  mealNote = "",
  analysisText = "",
  imageUrl = null,
  mealType = "",
}) {
  const phone = normalizePhone(from);
  const user = await getUserByPhone(phone);

  if (!user) {
    console.log("❌ לא נמצא משתמש:", phone);
    return false;
  }

  const validMealTypes = ["breakfast", "lunch", "dinner", "snack"];
  if (!validMealTypes.includes(mealType)) {
    console.log("❌ סוג ארוחה לא חוקי:", mealType);
    return false;
  }

  const userRef = db.collection("users").doc(user.id);

  try {
    await userRef.collection("meals").add({
      mealNote,
      analysisText,
      imageUrl,
      mealType,
      createdAt: new Date(),
      source: "whatsapp",
      phone,
    });

    console.log("✅ ארוחה נשמרה עבור user:", user.id, "סוג:", mealType);
    return true;
  } catch (error) {
    console.log("❌ שגיאה בשמירת ארוחה:", error?.message || error);
    return false;
  }
}

async function getUserMeals(phone, limit = 5) {
  const user = await getUserByPhone(phone);

  if (!user) {
    console.log("❌ לא נמצא משתמש:", phone);
    return [];
  }

  const snapshot = await db
    .collection("users")
    .doc(user.id)
    .collection("meals")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

// =====================
// Express
// =====================
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(cors());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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
        ingredients: analysis.ingredients,
        totalCalories: analysis.totalCalories,
        protein: analysis.protein,
        carbs: analysis.carbs,
        fat: analysis.fat,
        confidence: analysis.confidence,
      },
    });
  } catch (error) {
    if (error?.code === "AI_NOT_CONFIGURED") {
      res.status(503).json({ error: "AI analysis is not configured" });
      return;
    }

    console.log("❌ analyze endpoint failed:", error?.message || error);
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

    const normalizedIngredients = ingredients.map((item) => normalizeIngredientForStorage(item));

    const normalizedTotalCalories = Number(totalCalories || 0);
    const normalizedProtein = normalizeOptionalNumber(protein);
    const normalizedCarbs = normalizeOptionalNumber(carbs);
    const normalizedFat = normalizeOptionalNumber(fat);

    const computedTotals = normalizedIngredients.reduce(
      (acc, item) => {
        acc.calories += Number(item.calories || 0);
        acc.protein += Number(item.protein || 0);
        acc.carbs += Number(item.carbs || 0);
        acc.fat += Number(item.fat || 0);
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    const finalCalories =
      Number.isFinite(normalizedTotalCalories) && normalizedTotalCalories > 0
        ? normalizedTotalCalories
        : computedTotals.calories;

    const finalProtein = normalizedProtein ?? computedTotals.protein;
    const finalCarbs = normalizedCarbs ?? computedTotals.carbs;
    const finalFat = normalizedFat ?? computedTotals.fat;

    const entry = {
      mealType,
      mealName: String(mealName),
      imageUrl: String(imageUrl),
      ingredients: normalizedIngredients,
      totalCalories: finalCalories,
      analysis: {
        mealName: String(mealName),
        ingredients: normalizedIngredients,
        totalCalories: finalCalories,
        protein: finalProtein,
        carbs: finalCarbs,
        fat: finalFat,
      },
      analysisText: formatAnalysisText({
        mealName: String(mealName),
        ingredients: normalizedIngredients,
        totalCalories: finalCalories,
        protein: finalProtein,
        carbs: finalCarbs,
        fat: finalFat,
      }),
      createdAt: date ? new Date(date) : new Date(),
      source: "app",
    };

    if (finalProtein !== undefined) entry.protein = finalProtein;
    if (finalCarbs !== undefined) entry.carbs = finalCarbs;
    if (finalFat !== undefined) entry.fat = finalFat;

    const savedDoc = await db.collection("users").doc(String(userId)).collection("meals").add(entry);

    res.status(201).json({
      id: savedDoc.id,
      ok: true,
    });
  } catch (error) {
    console.log("❌ diary save endpoint failed:", error?.message || error);
    res.status(500).json({ error: "Failed to save meal in diary" });
  }
});

app.get("/", (req, res) => {
  const htmlPath = path.join(__dirname, "public", "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html.replaceAll(
    "__WA_PHONE__",
    process.env.WA_BUTTON_PHONE || "9725XXXXXXXX"
  );
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`✅ Web running: http://localhost:${PORT}`);
});

// =====================
// Memory
// =====================
const memory = new Map();
const pending = new Map();

function getHistory(chatId) {
  const h = memory.get(chatId) || [];
  return h.slice(-10);
}

function addToHistory(chatId, role, content) {
  const h = memory.get(chatId) || [];
  h.push({ role, content });
  memory.set(chatId, h.slice(-10));
}

// =====================
// Helpers
// =====================
function isGreeting(text) {
  const t = text.trim().toLowerCase();
  const greetings = [
    "היי",
    "הי",
    "שלום",
    "הלו",
    "אהלן",
    "מה קורה",
    "מה נשמע",
    "hi",
    "hello",
    "hey",
  ];
  return greetings.includes(t);
}

function shouldIgnoreMessage(msg, type) {
  if (!msg) return true;

  // Ignore messages sent by the bot itself
  if (msg.key?.fromMe) return true;

  const jid = msg.key?.remoteJid || "";

  // Ignore broadcasts and status updates
  if (jid === "status@broadcast") return true;
  if (jid.endsWith("@broadcast")) return true;

  // Ignore protocol/system messages
  if (msg.message?.protocolMessage) return true;
  if (msg.message?.senderKeyDistributionMessage) return true;

  // Ignore if no message object at all
  if (!msg.message) return true;

  // Accept both "notify" (new messages) and "append" (message updates/continuations)
  // Reject only truly system message types
  if (type !== "notify" && type !== "append") {
    return true;
  }

  return false;
}

function extractClarifyingQuestion(analysisText = "") {
  const match = analysisText.match(/שאלת הבהרה:\s*([\s\S]*)/);
  if (!match) return null;
  return match[1].trim().split("\n")[0].trim();
}

function sanitizeClarifyingQuestion(question = "") {
  const q = question.trim();

  const badPatterns = [
    "מה הכמות",
    "מהי הכמות",
    "כמות מדויקת",
    "הכמות המדויקת",
    "כמה גרם",
    "כמה מכל",
    "כמה מכל רכיב",
    "כמה מכל מרכיב",
    "כמה רכיבים",
    "מה הכמות המדויקת של כל",
    "מה הכמות של כל",
  ];

  const isBad = badPatterns.some((pattern) => q.includes(pattern));

  if (isBad || !q) {
    return "האם היה במנה רוטב, שמן, גבינה, שמנת או טיגון?";
  }

  return q;
}

function getFallbackClarifyingQuestion(analysisText = "") {
  const text = analysisText.toLowerCase();

  if (text.includes("סלט")) {
    return "האם היה רוטב, שמן או תוספות כמו קרוטונים וגבינה?";
  }

  if (text.includes("פסטה")) {
    return "האם היה רוטב שמנת, שמן, גבינה או חמאה?";
  }

  if (
    text.includes("טוסט") ||
    text.includes("כריך") ||
    text.includes("סנדוויץ")
  ) {
    return "האם היה רוטב, גבינה, חמאה או ממרח בתוך המנה?";
  }

  if (
    text.includes("שניצל") ||
    text.includes("צ'יפס") ||
    text.includes("מטוגן")
  ) {
    return "האם זה היה מטוגן בשמן והאם אכלת את כל המנה?";
  }

  if (text.includes("יוגורט") || text.includes("גרנולה")) {
    return "האם היה דבש, סוכר, גרנולה או תוספות נוספות?";
  }

  return "האם היה במנה רוטב, שמן, גבינה, שמנת או טיגון?";
}

function cleanAnalysisText(text = "") {
  return text
    .replace(/שאלת הבהרה:[\s\S]*/g, "")
    .replace(/זהו ניתוח ראשוני של ארוחה:/g, "")
    .replace(/זהו ניתוח ראשוני של תמונת אוכל:/g, "")
    .replace(/This is a preliminary analysis of a food image:/gi, "")
    .trim();
}

// =====================
// OpenAI helpers
// =====================
async function generateReply(chatId, userText) {
  const phone = normalizePhone(chatId);
  const recentMeals = await getUserMeals(phone, 5);
  const memoryService = await getMemoryService();

  let recentMessages = [];
  let userMemory = null;
  let latestSummary = null;

  if (memoryService) {
    try {
      recentMessages = await memoryService.getRecentMessages(phone, 10);
    } catch (error) {
      console.log("⚠️ getRecentMessages failed:", error?.message || error);
    }

    try {
      userMemory = await memoryService.getUserMemory(phone);
    } catch (error) {
      console.log("⚠️ getUserMemory failed:", error?.message || error);
    }

    try {
      latestSummary = await memoryService.getLatestSummary(phone);
    } catch (error) {
      console.log("⚠️ getLatestSummary failed:", error?.message || error);
    }
  }

  const mealsSummary = recentMeals.length
    ? recentMeals
        .map(
          (meal, i) =>
            `${i + 1}. תאריך: ${meal.createdAt}
סוג ארוחה: ${meal.mealType || "לא ידוע"}
הערת משתמש: ${meal.mealNote || "ללא הערה"}
ניתוח: ${meal.analysisText}`
        )
        .join("\n\n")
    : "אין היסטוריית ארוחות קודמת.";

  const latestSummaryText = latestSummary?.summary
    ? String(latestSummary.summary)
    : "אין סיכום שיחה זמין.";

  const messages = [
    {
      role: "system",
      content: `
את סוכנת תזונה חכמה, נעימה, מקצועית ותומכת.
עני תמיד בעברית טבעית, קצרה וברורה.

הנחיות:
- אם המשתמש/ת שואל/ת על אוכל, קלוריות, חלבון, דיאטה, שובע, נשנושים או ארוחות - תעני כמו עוזרת תזונה חכמה.
- אם זו הודעה כללית, עדיין תעני בטבעיות ובנעימות.
- תני תשובות פרקטיות וקצרות יחסית.
- אם חסר מידע, שאלי שאלה אחת קצרה.
- השתמשי בהיסטוריית הארוחות והזיכרון אם זה עוזר לתת תשובה אישית יותר.
- אל תתני ייעוץ רפואי.

החזירי תמיד ורק JSON תקין במבנה הבא:
{
  "reply": "string",
  "shouldSaveMemory": boolean,
  "memoryUpdate": {
    "height": 0,
    "weight": 0,
    "goalWeight": 0,
    "activityLevel": "",
    "dietPreferences": [],
    "allergies": [],
    "likedFoods": [],
    "dislikedFoods": [],
    "notes": ""
  }
}

כללים לשמירת זיכרון:
- shouldSaveMemory=true רק אם המשתמש/ת נתן/ה מידע יציב וארוך-טווח.
- לשמור רק שדות מתוך: height, weight, goalWeight, activityLevel, dietPreferences, allergies, likedFoods, dislikedFoods, notes.
- לא לשמור מידע זמני, חד-פעמי, רעב רגעי, ארוחה של היום, מצב רוח רגעי.
- אם אין עדכון זיכרון: shouldSaveMemory=false ו-memoryUpdate={}. 

היסטוריית שיחה אחרונה:
${formatRecentMessagesForPrompt(recentMessages)}

זיכרון משתמש ארוך-טווח:
${formatUserMemoryForPrompt(userMemory)}

סיכום שיחה אחרון:
${latestSummaryText}

היסטוריית ארוחות אחרונה:
${mealsSummary}
`.trim(),
    },
    { role: "user", content: userText },
  ];

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.6,
  });

  const rawContent = resp.choices?.[0]?.message?.content?.trim() || "";
  const parsed = parseAssistantJson(rawContent);

  if (!parsed || typeof parsed !== "object") {
    return {
      reply:
        rawContent ||
        "תכתבי לי שוב ואנסה לעזור בצורה יותר מדויקת 🙏",
      shouldSaveMemory: false,
      memoryUpdate: null,
    };
  }

  const reply = String(parsed.reply || "").trim();
  const memoryUpdate = sanitizeMemoryUpdate(parsed.memoryUpdate || {});
  const shouldSaveMemory = Boolean(parsed.shouldSaveMemory) && Boolean(memoryUpdate);

  return {
    reply: reply || "תכתבי לי שוב ואנסה לעזור בצורה יותר מדויקת 🙏",
    shouldSaveMemory,
    memoryUpdate,
  };
}

async function estimateCaloriesFromImage(imageDataUrl, userNote = "") {
  const prompt = `
את תזונאית דיגיטלית חכמה שמנתחת תמונות אוכל.

המטרה שלך:
1. לזהות את האוכל
2. לפרט את רכיבי המנה
3. לתת לכל רכיב ערכים תזונתיים משוערים
4. להעריך סה"כ קלוריות ומאקרו
5. לשאול שאלה אחת קצרה שתשפר דיוק

חוקים חשובים מאוד:
- אסור לשאול על כמויות מדויקות של רכיבים.
- אסור לשאול שאלות שהמשתמש/ת כנראה לא יודע/ת לענות עליהן.
- מותר לשאול רק שאלות פשוטות ומעשיות, כמו:
  - האם היה רוטב?
  - האם היה שמן או חמאה?
  - האם זה מטוגן, אפוי או מבושל?
  - האם יש גבינה / שמנת / מיונז?
  - האם אכלת את כל המנה או רק חלק?
  - האם יש תוספת שלא רואים טוב בתמונה?
- השאלה חייבת להיות קצרה מאוד, טבעית וברורה.
- אם אין שאלה טובה במיוחד, שאלי:
  "האם היה במנה רוטב, שמן, גבינה או טיגון?"

החזירי בדיוק במבנה הזה:

זיהיתי:
[מה יש בתמונה]

רכיבים מפורטים:
[רכיב 1] | [קלוריות] | [חלבון] | [פחמימות] | [שומן] | [כמות/יחידות]
[רכיב 2] | [קלוריות] | [חלבון] | [פחמימות] | [שומן] | [כמות/יחידות]

קלוריות משוערות:
[טווח]
הערכה סבירה: [מספר אחד]

מאקרו משוער:
חלבון: [טווח]
פחמימות: [טווח]
שומן: [טווח]

💡 תובנות:
[2-3 משפטים קצרים על הארוחה]

שאלת הבהרה:
[שאלה אחת קצרה בלבד]

${userNote ? `הערת המשתמש: ${userNote}` : "אין הערת משתמש."}
`.trim();

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  });

  return (
    resp.choices?.[0]?.message?.content?.trim() ||
    "לא הצלחתי להעריך את הקלוריות מהתמונה. נסי לשלוח תמונה ברורה יותר 🙏"
  );
}

async function refineMealAnalysis(originalAnalysis, clarificationAnswer) {
  const prompt = `
זהו ניתוח ראשוני של תמונת אוכל:
${originalAnalysis}

המשתמש/ת הוסיף/ה הבהרה:
${clarificationAnswer}

עדכני את הערכת הקלוריות והמאקרו לפי ההבהרה.
כתבי בעברית טבעית, קצרה וברורה.
שמרי על אותו מבנה תשובה של הניתוח המקורי, כולל "רכיבים מפורטים" עם ערכים לכל רכיב,
אבל בלי "שאלת הבהרה" בסוף.
`.trim();

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  });

  return resp.choices?.[0]?.message?.content?.trim() || originalAnalysis;
}

// =====================
// WhatsApp Bot
// =====================
let sock = null;
let isStarting = false;
let reconnectTimer = null;

/**
 * Cleanup corrupted auth_info directory
 */
function cleanAuthDirectory() {
  const authDir = path.join(__dirname, "auth_info");
  if (fs.existsSync(authDir)) {
    try {
      fs.rmSync(authDir, { recursive: true, force: true });
      console.log("🧹 Cleaned up auth_info directory");
    } catch (err) {
      console.log("⚠️ Failed to clean auth_info:", err?.message);
    }
  }
}

async function startBot() {
  if (isStarting) return;
  isStarting = true;

  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log("❌ חסר OPENAI_API_KEY בקובץ .env");
      isStarting = false;
      return;
    }

    if (!process.env.FIREBASE_STORAGE_BUCKET) {
      console.log("❌ חסר FIREBASE_STORAGE_BUCKET בקובץ .env");
      isStarting = false;
      return;
    }

    // Close existing socket properly
    if (sock?.ws) {
      try {
        sock.ws.close();
        sock = null;
      } catch (err) {
        console.log("⚠️ Error closing existing socket:", err?.message);
      }
    }

    // Cleanup timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    console.log("🔄 Initializing WhatsApp Bot...");

    const authDir = path.join(__dirname, "auth_info");
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      auth: state,
      version,
      browser: Browsers.macOS("Desktop"),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    console.log("📝 Setting up event listeners...");

    // Save credentials whenever updated
    sock.ev.on("creds.update", saveCreds);

    // Handle QR code generation and connection state
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      console.log(`📡 Connection state: ${connection}`);

      // Display QR code if available
      if (qr) {
        console.log("\n📱 QR CODE - Scan with WhatsApp:");
        console.log("Go to WhatsApp > Settings > Linked Devices > Link a Device\n");
        qrcode.generate(qr, { small: true });
      }

      // Handle successful connection
      if (connection === "open") {
        console.log("✅ Successfully connected to WhatsApp!");
        isStarting = false;
        
        // Clear reconnection timer
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      }

      // Handle disconnection with specific error codes
      if (connection === "close") {
        const reason = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || "Unknown error";
        
        console.log(`\n❌ Connection closed - Code: ${reason} - ${errorMessage}`);

        // 401 Unauthorized - session expired or logged out
        if (reason === 401 || reason === DisconnectReason.loggedOut) {
          console.log("🔐 Re-authentication required (401 Unauthorized)");
          console.log("🧹 Cleaning up corrupted session...");
          cleanAuthDirectory();
          console.log("↻ Restart the bot to scan new QR code");
          isStarting = false;
          return;
        }

        // 403 Forbidden - generally means connection replaced
        if (reason === 403) {
          console.log("⚠️ Session replaced (403)");
          console.log("This may happen if you connected on another device");
          cleanAuthDirectory();
          isStarting = false;
          return;
        }

        // 405 Not Allowed - typically device pairing issue
        if (reason === 405) {
          console.log("⚠️ Device pairing issue (405)");
          cleanAuthDirectory();
          isStarting = false;
          return;
        }

        // 515 Restart Required
        if (reason === 515 || reason === DisconnectReason.restartRequired) {
          console.log("🔄 Restart required (515) - reconnecting in 2 seconds...");
          isStarting = false;
          if (!reconnectTimer) {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              startBot();
            }, 2000);
          }
          return;
        }

        // Handle connection conflicts from group chats
        if (reason === 440) {
          console.log("⚠️ Connection conflict (440) - likely group message issue");
          console.log("🔄 Attempting to reconnect in 3 seconds...");
          isStarting = false;
          if (!reconnectTimer) {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              startBot();
            }, 3000);
          }
          return;
        }

        // Generic reconnection for other errors
        console.log("🔄 Reconnecting in 3 seconds...");
        isStarting = false;
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            startBot();
          }, 3000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      const msg = messages?.[0];

      if (!msg) {
        console.log("⏭️ messages.upsert received with no message");
        return;
      }

      if (shouldIgnoreMessage(msg, type)) {
        console.log("⏭️  Skip: System/non-user message (type: %s)", type);
        return;
      }

      const from = msg.key.remoteJid;
      const fromNumber = normalizePhone(from);

      if (fromNumber === BOT_NUMBER) {
        console.log("⏭️  Skip: Bot's own message");
        return;
      }

      if (ALLOWED_NUMBERS.size && !ALLOWED_NUMBERS.has(fromNumber)) {
        console.log("⏭️  Skip: Not in allowlist (%s)", fromNumber);
        return;
      }

      const rawMessage = msg.message;
      const m =
        rawMessage?.ephemeralMessage?.message ||
        rawMessage?.viewOnceMessage?.message ||
        rawMessage;

      const imageMessage = m?.imageMessage;
      const text =
        m?.conversation ||
        m?.extendedTextMessage?.text ||
        imageMessage?.caption ||
        "";

      console.log("✅ Accepted: type=%s text=%s", type, text ? `"${text.substring(0, 40)}..."` : "[no text]");

      try {

        if (imageMessage) {
          await sock.sendMessage(from, {
            text: "מנתחת את התמונה עכשיו, רגע 🙏",
          });

          const buffer = await downloadMediaMessage(
            msg,
            "buffer",
            {},
            { reuploadRequest: sock.updateMediaMessage }
          );

          const mime = imageMessage.mimetype || "image/jpeg";
          const base64 = buffer.toString("base64");
          const dataUrl = `data:${mime};base64,${base64}`;

          addToHistory(from, "user", text ? `[תמונה] ${text}` : "[תמונה]");

          const analysis = await estimateCaloriesFromImage(dataUrl, text);

          const extractedQuestion = extractClarifyingQuestion(analysis);
          const clarificationQuestion = sanitizeClarifyingQuestion(
            extractedQuestion || getFallbackClarifyingQuestion(analysis)
          );

          let uploadedImageUrl = null;

          try {
            uploadedImageUrl = await uploadMealImage(buffer, mime, fromNumber);
            console.log("✅ image uploaded:", uploadedImageUrl);
          } catch (uploadErr) {
            console.log(
              "❌ failed uploading image:",
              uploadErr?.message || uploadErr
            );
          }

          pending.set(from, {
            step: "awaiting_clarification",
            imageUrl: uploadedImageUrl,
            analysisText: analysis,
            mealNote: text || "",
            createdAt: Date.now(),
          });

          await sock.sendMessage(from, {
            text: `${cleanAnalysisText(analysis)}

כדי לדייק יותר:
${clarificationQuestion}`,
          });

          addToHistory(from, "assistant", cleanAnalysisText(analysis));
          return;
        }

        if (text.trim()) {
          const cleanText = text.trim();
          const p = pending.get(from);

          if (p?.step === "awaiting_clarification") {
            const refinedAnalysis = await refineMealAnalysis(
              p.analysisText,
              cleanText
            );

            pending.set(from, {
              ...p,
              step: "awaiting_meal_type",
              analysisText: cleanAnalysisText(refinedAnalysis),
              mealNote: p.mealNote,
            });

            await sock.sendMessage(from, {
              text: `${cleanAnalysisText(refinedAnalysis)}

איזו ארוחה זו הייתה?
כתבי רק אחת מהאפשרויות:
בוקר
צהריים
ערב
ביניים`,
            });

            return;
          }

          if (p?.step === "awaiting_meal_type") {
            const mealType = normalizeMealType(cleanText);

            if (!mealType) {
              await sock.sendMessage(from, {
                text: "לא הבנתי את סוג הארוחה.\nכתבי רק:\nבוקר\nצהריים\nערב\nביניים",
              });
              return;
            }

            const saved = await saveMealEntry({
              from,
              mealNote: p.mealNote,
              analysisText: cleanAnalysisText(p.analysisText),
              imageUrl: p.imageUrl,
              mealType,
            });

            pending.delete(from);

            await sock.sendMessage(from, {
              text: saved
                ? "✅ נשמר בהצלחה ליומן באתר"
                : "לא מצאתי משתמש באתר עם מספר הטלפון הזה. תוודאי שבאתר נשמר אותו מספר טלפון בדיוק.",
            });

            return;
          }

          addToHistory(from, "user", cleanText);

          const phone = normalizePhone(from);
          const memoryService = await getMemoryService();

          // Save user message to Firestore
          if (memoryService) {
            try {
              await memoryService.saveMessage(phone, "user", cleanText);
              console.log("💾 Firestore: Saved user message");
            } catch (error) {
              console.log("⚠️  Firestore error (save user): %s", error?.message || error);
            }
          }

          const replyData = await generateReply(from, cleanText);
          const reply = replyData?.reply || replyData;

          await sock.sendMessage(from, { text: reply });

          addToHistory(from, "assistant", reply);

          // Save assistant message and update memory if needed
          if (memoryService) {
            try {
              await memoryService.saveMessage(phone, "assistant", reply);
              console.log("💾 Firestore: Saved assistant message");
            } catch (error) {
              console.log("⚠️  Firestore error (save assistant): %s", error?.message || error);
            }

            if (replyData?.shouldSaveMemory && replyData?.memoryUpdate) {
              try {
                await memoryService.upsertUserMemory(phone, replyData.memoryUpdate);
                console.log("💾 Firestore: Updated user memory");
              } catch (error) {
                console.log("⚠️  Firestore error (update memory): %s", error?.message || error);
              }
            }
          }

          return;
        }

        console.log("unsupported message");
      } catch (err) {
        console.log("❌ Error in messages.upsert:", err?.message || err);

        try {
          await sock.sendMessage(from, {
            text: "הייתה לי תקלה קטנה, נסי שוב עוד רגע 🙏",
          });
        } catch (sendErr) {
          console.log(
            "❌ failed sending error message:",
            sendErr?.message || sendErr
          );
        }
      }
    });
  } catch (err) {
    console.log("❌ ❌ Fatal error initializing bot:", err?.message || err);
    console.log("Stack trace:", err?.stack);
    isStarting = false;
    
    // Retry after delay
    console.log("🔄 Retrying in 5 seconds...");
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startBot();
      }, 5000);
    }
  }
}

startBot();