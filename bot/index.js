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
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import qrcode from "qrcode-terminal";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import {
  analyzeMealDataUrl,
  analyzeMealImage,
  repairMealAnalysisFromClarification,
} from "./services/meal-analysis.js";
import {
  MEMORY_CATEGORIES,
  mergeLongTermMemoryPatch,
  sanitizeMemoryPatch,
  sanitizeProfileForMemoryUpdate,
} from "./services/memory-update/merge.helper.js";
import {
  canonicalAnalysisToLegacyText,
  mealAnalysisNeedsClarification,
  normalizeMealAnalysis,
} from "../shared/meal-analysis.js";
import {
  buildCanonicalMealUpdatePayload,
  extractBearerToken,
  validateMealEditDraft,
} from "../shared/meal-edit.js";
import { isGeneralNutritionQuestion } from "./services/nutrition-routing.helper.js";
import { getNutritionKnowledgeAnswer } from "./services/nutrition-knowledge.service.js";
import { detectNutritionTargetRequest } from "./services/nutrition-targets-routing.helper.js";
import {
  getNutritionTarget,
  getMissingFields as getMissingNutritionTargetFields,
  buildMissingFieldsQuestion,
  parseNutritionProfileFields,
  parseSingleFieldAnswerResult,
  getInvalidFieldMessage,
  formatNutritionTargetReplyHebrew,
  detectUnsafeConditions,
  getUnsafeConditionMessage,
  normalizeSex,
  normalizeActivityLevel,
  normalizeGoal,
  mergeNutritionProfile,
  ACTIVITY_LEVEL_SHORT_LABEL_HEBREW,
  REQUIRED_CALORIE_FIELDS,
  REQUIRED_PROTEIN_FIELDS,
} from "./services/nutrition-targets.service.js";
import {
  getProductByBarcode,
  calculateNutritionForWeight,
  calculateNutritionForPackageFraction,
  hasUsableCoreNutrition,
  formatProductNutritionForUser,
  formatProductConfirmationSummary,
  formatPackageFractionLabel,
  findBarcodeCandidate,
  hasExplicitBarcodeIntent,
  PRODUCT_NOT_FOUND_HEBREW,
  PRODUCT_LOOKUP_UNAVAILABLE_HEBREW,
  PRODUCT_INCOMPLETE_HEBREW,
  INVALID_BARCODE_HEBREW,
  PACKAGE_WEIGHT_IS_VOLUME_HEBREW,
} from "./services/food-product.service.js";
import { parseProductAmountInput } from "./services/product-amount.helper.js";
import { decodeBarcodeFromImage } from "./services/barcode-image.service.js";
import {
  resolveImageBarcodeRouting,
  isBarcodeModeActive,
  IMAGE_BARCODE_ROUTES,
} from "./services/barcode-image-routing.helper.js";
import {
  classifyPackagedProductImage,
  classifyFoodImage,
  FOOD_IMAGE_MIN_CONFIDENCE,
} from "./services/packaged-product-image.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// True only when this file is executed directly (`node index.js` / `npm
// start`), not when it's imported by another module (e.g. a test process).
// Gates the two real side-effecting startup calls below — app.listen()
// (binds a real TCP port) and startBot() (an infinite WhatsApp
// connect/retry loop) — so the orchestration functions in this file
// (startNutritionTargetFlow, handleNutritionTargetInfoInput,
// handleStandaloneProfileUpdate, etc.) can be imported and exercised
// directly by integration tests with a mocked `sock`/Firestore, instead of
// only through the hand-maintained Express-only mirror in
// integration/app.harness.js.
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

// =====================
// Config
// =====================
const PORT = Number(process.env.PORT || 3000);

const DEFAULT_CONVERSATION_SUMMARY_THRESHOLD = 20;
const parsedConversationSummaryThreshold = Number(process.env.CONVERSATION_SUMMARY_THRESHOLD);
const CONVERSATION_SUMMARY_THRESHOLD = Number.isFinite(parsedConversationSummaryThreshold)
  && parsedConversationSummaryThreshold > 0
  ? Math.floor(parsedConversationSummaryThreshold)
  : DEFAULT_CONVERSATION_SUMMARY_THRESHOLD;
const CONVERSATION_SUMMARY_MODEL = "gpt-4o-mini";

const DEFAULT_MEMORY_RECENT_MESSAGES_LIMIT = 8;
const parsedMemoryRecentMessagesLimit = Number(process.env.MEMORY_RECENT_MESSAGES_LIMIT);
const MEMORY_RECENT_MESSAGES_LIMIT = Number.isFinite(parsedMemoryRecentMessagesLimit)
  ? Math.max(2, Math.min(20, Math.floor(parsedMemoryRecentMessagesLimit)))
  : DEFAULT_MEMORY_RECENT_MESSAGES_LIMIT;

const DEFAULT_MEMORY_UPDATE_MIN_CONFIDENCE = 0.75;
const DEFAULT_MEMORY_SAFETY_REMOVAL_MIN_CONFIDENCE = 0.95;
const MEMORY_UPDATE_MIN_CONFIDENCE = Math.max(
  0,
  Math.min(1, Number.isFinite(Number(process.env.MEMORY_UPDATE_MIN_CONFIDENCE))
    ? Number(process.env.MEMORY_UPDATE_MIN_CONFIDENCE)
    : DEFAULT_MEMORY_UPDATE_MIN_CONFIDENCE)
);
const MEMORY_SAFETY_REMOVAL_MIN_CONFIDENCE = Math.max(
  0,
  Math.min(1, Number.isFinite(Number(process.env.MEMORY_SAFETY_REMOVAL_MIN_CONFIDENCE))
    ? Number(process.env.MEMORY_SAFETY_REMOVAL_MIN_CONFIDENCE)
    : DEFAULT_MEMORY_SAFETY_REMOVAL_MIN_CONFIDENCE)
);

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
    .map((phone) => normalizePhone(phone))
    .filter(Boolean)
);

if (ALLOWED_NUMBERS.size > 0) {
  const label = ALLOWED_NUMBERS.size === 1 ? "phone" : "phones";
  console.log(`ALLOWLIST ENABLED: ${ALLOWED_NUMBERS.size} authorized ${label}`);
}

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

function normalizeContentForComparison(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toMillisOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") {
    const dt = value.toDate();
    return dt instanceof Date ? dt.getTime() : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function sanitizeLongTermMemoryForContext(userMemory) {
  const profile = userMemory?.profile;
  if (!profile || typeof profile !== "object") return null;

  const fields = [
    "goals",
    "goalWeight",
    "weight",
    "height",
    "activityLevel",
    "dietPreferences",
    "allergies",
    "sensitivities",
    "dietaryRestrictions",
    "likedFoods",
    "dislikedFoods",
    "eatingHabits",
    "persistentConstraints",
    "acceptedRecommendations",
    "importantNotes",
    "notes",
  ];

  const cleaned = {};

  for (const field of fields) {
    const raw = profile[field];
    if (raw === undefined || raw === null) continue;

    if (Array.isArray(raw)) {
      const values = Array.from(
        new Set(raw.map((item) => String(item || "").trim()).filter(Boolean))
      );
      if (values.length) cleaned[field] = values;
      continue;
    }

    if (typeof raw === "number") {
      if (Number.isFinite(raw)) cleaned[field] = raw;
      continue;
    }

    const asString = String(raw).trim();
    if (asString) cleaned[field] = asString;
  }

  return Object.keys(cleaned).length ? cleaned : null;
}

function formatLongTermMemorySection(longTermMemory) {
  if (!longTermMemory) return "אין זיכרון משתמש ארוך-טווח.";
  try {
    return JSON.stringify(longTermMemory, null, 2);
  } catch {
    return "אין זיכרון משתמש ארוך-טווח.";
  }
}

function formatRecentConversationSection(messages = []) {
  if (!Array.isArray(messages) || !messages.length) return "אין הודעות אחרונות זמינות.";

  return messages
    .map((msg) => {
      const role = String(msg?.role || "user").toLowerCase() === "assistant" ? "Assistant" : "User";
      const content = String(msg?.content || "").trim();
      return `${role}: ${content}`;
    })
    .join("\n");
}

function dedupeRecentMessages(messages = []) {
  const seen = new Set();
  const deduped = [];

  for (const msg of messages) {
    const role = String(msg?.role || "").trim();
    const content = String(msg?.content || "").trim();
    if (!(role === "user" || role === "assistant") || !content) continue;

    const key = [
      role,
      String(msg?.messageId || ""),
      normalizeContentForComparison(content),
      String(toMillisOrNull(msg?.createdAt) || ""),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      role,
      content,
      createdAt: msg?.createdAt,
      messageId: msg?.messageId || null,
    });
  }

  return deduped;
}

function dropCurrentUserMessageDuplicate(messages = [], { currentUserMessage, currentMessageId, currentMessageTimestampMs }) {
  if (!Array.isArray(messages) || !messages.length) return [];

  if (currentMessageId) {
    return messages.filter(
      (msg) => !(msg.role === "user" && String(msg?.messageId || "") === String(currentMessageId))
    );
  }

  const normalizedCurrent = normalizeContentForComparison(currentUserMessage);
  if (!normalizedCurrent) return messages;

  let removed = false;

  return messages.filter((msg) => {
    if (removed || msg.role !== "user") return true;

    const sameContent = normalizeContentForComparison(msg.content) === normalizedCurrent;
    if (!sameContent) return true;

    if (!currentMessageTimestampMs) {
      removed = true;
      return false;
    }

    const msgTs = toMillisOrNull(msg.createdAt);
    const withinWindow = msgTs !== null && Math.abs(msgTs - currentMessageTimestampMs) <= 2 * 60 * 1000;
    if (!withinWindow) return true;

    removed = true;
    return false;
  });
}

async function buildMemoryContext(phone, { currentUserMessage = "", currentMessageId = "", currentMessageTimestampMs = null } = {}) {
  const memoryService = await getMemoryService();
  const context = {
    latestSummary: null,
    longTermMemory: null,
    recentMessages: [],
  };

  if (!memoryService) {
    console.log("MEMORY CONTEXT READY", {
      phone,
      recentMessageCount: 0,
      source: "all",
    });
    return context;
  }

  console.log("MEMORY RETRIEVAL STARTED", {
    phone,
    source: "all",
  });

  const [summaryResult, longTermResult, recentResult] = await Promise.allSettled([
    memoryService.getLatestSummary(phone),
    memoryService.getUserMemory(phone),
    memoryService.getRecentEligibleMessages(phone, { limit: MEMORY_RECENT_MESSAGES_LIMIT }),
  ]);

  let summaryDoc = null;

  if (summaryResult.status === "fulfilled") {
    summaryDoc = summaryResult.value;
    context.latestSummary = summaryDoc?.summary ? String(summaryDoc.summary).trim() : null;
    console.log("MEMORY SUMMARY LOADED", {
      phone,
      source: "summary",
      loaded: Boolean(context.latestSummary),
    });
  } else {
    console.log("MEMORY SOURCE FAILED", {
      phone,
      source: "summary",
      error: summaryResult.reason?.message || summaryResult.reason,
    });
  }

  if (longTermResult.status === "fulfilled") {
    context.longTermMemory = sanitizeLongTermMemoryForContext(longTermResult.value);
    console.log("MEMORY LONG-TERM LOADED", {
      phone,
      source: "long-term",
      loaded: Boolean(context.longTermMemory),
    });
  } else {
    console.log("MEMORY SOURCE FAILED", {
      phone,
      source: "long-term",
      error: longTermResult.reason?.message || longTermResult.reason,
    });
  }

  if (recentResult.status === "fulfilled") {
    let recentMessages = Array.isArray(recentResult.value) ? recentResult.value : [];

    if (summaryDoc?.summarizedUntil) {
      const summaryCutoffMs = toMillisOrNull(summaryDoc.summarizedUntil);
      if (summaryCutoffMs !== null) {
        recentMessages = recentMessages.filter((msg) => {
          const msgMs = toMillisOrNull(msg?.createdAt);
          return msgMs !== null && msgMs > summaryCutoffMs;
        });
      }
    }

    recentMessages = dedupeRecentMessages(recentMessages);
    recentMessages = dropCurrentUserMessageDuplicate(recentMessages, {
      currentUserMessage,
      currentMessageId,
      currentMessageTimestampMs,
    });

    context.recentMessages = recentMessages.slice(-MEMORY_RECENT_MESSAGES_LIMIT);

    console.log("MEMORY RECENT MESSAGES LOADED", {
      phone,
      source: "recentMessages",
      count: context.recentMessages.length,
    });
  } else {
    console.log("MEMORY SOURCE FAILED", {
      phone,
      source: "recentMessages",
      error: recentResult.reason?.message || recentResult.reason,
    });
  }

  console.log("MEMORY CONTEXT READY", {
    phone,
    source: "all",
    recentMessageCount: context.recentMessages.length,
  });

  return context;
}

function parsePatchJson(rawContent = "") {
  const parsed = parseAssistantJson(rawContent);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}

function buildMemoryExtractionPrompt({ userMessage, currentMemory, latestSummary }) {
  const memoryJson = JSON.stringify(currentMemory || {}, null, 2);
  const summaryText = latestSummary ? String(latestSummary).slice(0, 1500) : "";

  const categories = MEMORY_CATEGORIES.join(", ");

  return `
את עוזרת תזונה שמחלצת עדכון זיכרון ארוך-טווח מהודעת משתמש אחת.

החזירי JSON בלבד ללא טקסט נוסף.

כללים:
- השתמשי בעיקר בהודעה הנוכחית כראיה ראשית.
- אל תסיקי עובדות רפואיות שלא נאמרו במפורש.
- אל תוסיפי עובדות לא יציבות או חד-פעמיות.
- אל תשמרי ברכות, מצב רוח רגעי או שיחת חולין.
- הסירי עובדות רק אם יש ביטול מפורש.
- להסרת אלרגיה/רגישות נדרשת ודאות גבוהה מאוד.

קטגוריות מותרות בלבד:
${categories}

החזירי במבנה:
{
  "add": { "...": [] },
  "remove": { "...": [] },
  "replace": {
    "goals": null,
    "dietaryPreferences": null,
    "dietaryRestrictions": null,
    "persistentConstraints": null
  },
  "confidence": 0,
  "shouldUpdate": false,
  "reason": ""
}

אם אין עדכון יציב: shouldUpdate=false וכל המערכים ריקים.

[CURRENT USER MESSAGE]
${String(userMessage || "").trim()}

[CURRENT LONG-TERM MEMORY]
${memoryJson}

[LATEST SUMMARY - OPTIONAL CONTEXT]
${summaryText || "אין"}
`.trim();
}

async function extractMemoryPatchFromMessage({ phone, userMessage, currentMemory, latestSummary }) {
  console.log("MEMORY UPDATE EXTRACTION STARTED", {
    phone,
    source: "model",
  });

  const prompt = buildMemoryExtractionPrompt({
    userMessage,
    currentMemory,
    latestSummary,
  });

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [{ role: "user", content: prompt }],
  });

  const rawContent = String(resp.choices?.[0]?.message?.content || "").trim();
  const rawPatch = parsePatchJson(rawContent);
  const patch = sanitizeMemoryPatch(rawPatch);

  console.log("MEMORY UPDATE PATCH READY", {
    phone,
    confidence: patch.confidence,
    shouldUpdate: patch.shouldUpdate,
  });

  return patch;
}

const activeMemoryUpdateJobs = new Set();

async function maybeUpdateLongTermMemory({
  phone,
  sourceType,
  messageId,
  userMessage,
}) {
  const normalizedPhone = String(phone || "").trim();
  const normalizedMessageId = String(messageId || "").trim();
  const cleanUserMessage = String(userMessage || "").trim();

  console.log("MEMORY UPDATE CHECK", {
    phone: normalizedPhone,
    messageId: normalizedMessageId || null,
    source: sourceType,
  });

  if (!normalizedPhone || normalizedPhone.includes("@")) {
    console.log("MEMORY UPDATE SKIPPED", {
      phone: normalizedPhone || null,
      messageId: normalizedMessageId || null,
      reason: "invalid_phone",
    });
    return;
  }

  if (sourceType !== "notify") {
    console.log("MEMORY UPDATE SKIPPED", {
      phone: normalizedPhone,
      messageId: normalizedMessageId || null,
      reason: "not_notify_event",
    });
    return;
  }

  if (!cleanUserMessage) {
    console.log("MEMORY UPDATE SKIPPED", {
      phone: normalizedPhone,
      messageId: normalizedMessageId || null,
      reason: "empty_text",
    });
    return;
  }

  if (activeMemoryUpdateJobs.has(normalizedPhone)) {
    console.log("MEMORY UPDATE LOCKED", {
      phone: normalizedPhone,
      messageId: normalizedMessageId || null,
    });
    return;
  }

  activeMemoryUpdateJobs.add(normalizedPhone);

  try {
    const memoryService = await getMemoryService();
    if (!memoryService) {
      console.log("MEMORY UPDATE SKIPPED", {
        phone: normalizedPhone,
        messageId: normalizedMessageId || null,
        reason: "memory_service_unavailable",
      });
      return;
    }

    const [memoryResult, summaryResult] = await Promise.allSettled([
      memoryService.getUserMemory(normalizedPhone),
      memoryService.getLatestSummary(normalizedPhone),
    ]);

    const currentProfile = memoryResult.status === "fulfilled"
      ? (memoryResult.value?.profile && typeof memoryResult.value.profile === "object"
        ? memoryResult.value.profile
        : {})
      : {};

    const latestSummaryText = summaryResult.status === "fulfilled"
      ? summaryResult.value?.summary || ""
      : "";

    const modelMemoryContext = sanitizeProfileForMemoryUpdate(currentProfile);

    const patch = await extractMemoryPatchFromMessage({
      phone: normalizedPhone,
      userMessage: cleanUserMessage,
      currentMemory: modelMemoryContext,
      latestSummary: latestSummaryText,
    });

    if (!patch.shouldUpdate) {
      console.log("MEMORY UPDATE SKIPPED", {
        phone: normalizedPhone,
        messageId: normalizedMessageId || null,
        reason: "model_declined_update",
        confidence: patch.confidence,
      });
      return;
    }

    if (patch.confidence < MEMORY_UPDATE_MIN_CONFIDENCE) {
      console.log("MEMORY UPDATE SKIPPED", {
        phone: normalizedPhone,
        messageId: normalizedMessageId || null,
        reason: "low_confidence",
        confidence: patch.confidence,
      });
      return;
    }

    const mergeResult = mergeLongTermMemoryPatch(currentProfile, patch, {
      safetyRemovalMinConfidence: MEMORY_SAFETY_REMOVAL_MIN_CONFIDENCE,
    });

    if (mergeResult.blockedRemovals.length) {
      console.log("MEMORY SAFETY REMOVAL BLOCKED", {
        phone: normalizedPhone,
        messageId: normalizedMessageId || null,
        confidence: patch.confidence,
        categories: mergeResult.blockedRemovals.map((item) => item.category),
      });
    }

    if (!mergeResult.changed) {
      console.log("MEMORY UPDATE NO CHANGES", {
        phone: normalizedPhone,
        messageId: normalizedMessageId || null,
      });
      return;
    }

    const saveResult = await memoryService.applyIntelligentMemoryUpdate(normalizedPhone, {
      updatedProfile: mergeResult.updatedMemory,
      messageId: normalizedMessageId,
      lastUpdatedCategories: mergeResult.changedCategories,
      lastUpdateSource: "user_message",
      memoryVersion: 2,
    });

    if (saveResult?.duplicate) {
      console.log("MEMORY UPDATE SKIPPED", {
        phone: normalizedPhone,
        messageId: normalizedMessageId || null,
        reason: "duplicate_message",
      });
      return;
    }

    console.log("MEMORY UPDATE SAVED", {
      phone: normalizedPhone,
      messageId: normalizedMessageId || null,
      changedCategories: mergeResult.changedCategories,
      confidence: patch.confidence,
    });
  } catch (error) {
    console.log("MEMORY UPDATE FAILED", {
      phone: normalizedPhone,
      messageId: normalizedMessageId || null,
      error: error?.message || error,
    });
  } finally {
    activeMemoryUpdateJobs.delete(normalizedPhone);
  }
}

function formatUserMemoryForPrompt(userMemory) {
  if (!userMemory?.profile) return "אין זיכרון משתמש ארוך-טווח.";

  try {
    return JSON.stringify(userMemory.profile, null, 2);
  } catch {
    return "אין זיכרון משתמש ארוך-טווח.";
  }
}

function formatConversationMessagesForSummaryPrompt(messages = []) {
  if (!Array.isArray(messages) || !messages.length) return "אין הודעות חדשות לסיכום.";

  return messages
    .map((msg, index) => {
      const role = String(msg?.role || "user");
      const content = String(msg?.content || "").trim();
      const ts = msg?.createdAt?.toDate?.() || msg?.createdAt || null;
      const iso = ts ? new Date(ts).toISOString() : "unknown-time";
      return `${index + 1}. [${iso}] ${role}: ${content}`;
    })
    .join("\n");
}

function timestampToMs(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") {
    const dt = value.toDate();
    return dt instanceof Date ? dt.getTime() : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

async function createConversationSummaryText({ previousSummary, newMessages, userMemory }) {
  const previousSummaryText = previousSummary?.summary
    ? String(previousSummary.summary)
    : "אין סיכום קודם.";

  const userMemoryText = formatUserMemoryForPrompt(userMemory);
  const messagesText = formatConversationMessagesForSummaryPrompt(newMessages);

  const prompt = `
את עוזרת תזונה שמסכמת שיחה למטרות המשכיות טיפולית.

הוראות:
- כתבי בעברית בלבד.
- כתבי סיכום תמציתי, עובדתי ומובנה לפי הכותרות הבאות בדיוק:
1) מטרות המשתמש
2) העדפות תזונתיות
3) מגבלות, אלרגיות ורגישויות
4) ארוחות ודפוסים חשובים
5) החלטות או המלצות שניתנו
6) מידע שחשוב להמשך השיחה
- אל תמציאי עובדות שלא הופיעו במידע.
- אל תכללי לוגים טכניים או מידע מערכת.
- אל תכללי ברכות לא רלוונטיות.
- אל תתני אבחנה רפואית.
- הבליטי עובדות רלוונטיות בעיקר מהתקופה האחרונה, תוך שמירה על עובדות ארוכות טווח חשובות.

סיכום קודם:
${previousSummaryText}

זיכרון משתמש ארוך-טווח:
${userMemoryText}

הודעות חדשות שטרם סוכמו:
${messagesText}
`.trim();

  const resp = await client.chat.completions.create({
    model: CONVERSATION_SUMMARY_MODEL,
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  });

  return String(resp.choices?.[0]?.message?.content || "").trim();
}

const activeSummaryJobs = new Set();

async function maybeCreateConversationSummary(phone) {
  const normalizedPhone = String(phone || "").trim();
  if (!normalizedPhone || normalizedPhone.includes("@")) {
    return;
  }

  if (activeSummaryJobs.has(normalizedPhone)) {
    console.log("SUMMARY LOCKED: already running", {
      phone: normalizedPhone,
    });
    return;
  }

  activeSummaryJobs.add(normalizedPhone);

  let newEligibleMessages = 0;

  try {
    const memoryService = await getMemoryService();
    if (!memoryService) return;

    const latestSummary = await memoryService.getLatestSummary(normalizedPhone);
    const unsummarized = await memoryService.getUnsummarizedMessages(normalizedPhone, {
      afterTimestamp: latestSummary?.summarizedUntil || null,
      limit: Math.max(CONVERSATION_SUMMARY_THRESHOLD * 5, 120),
      lookbackDays: 90,
    });

    const eligibleMessages = unsummarized.filter((msg) => {
      const role = String(msg?.role || "").trim();
      const content = String(msg?.content || "").trim();
      return (role === "user" || role === "assistant") && Boolean(content);
    });

    newEligibleMessages = eligibleMessages.length;

    console.log("SUMMARY CHECK", {
      phone: normalizedPhone,
      newEligibleMessages,
      threshold: CONVERSATION_SUMMARY_THRESHOLD,
    });

    if (newEligibleMessages < CONVERSATION_SUMMARY_THRESHOLD) {
      console.log("SUMMARY SKIPPED: threshold not reached", {
        phone: normalizedPhone,
        newEligibleMessages,
      });
      return;
    }

    const maxBatchSize = CONVERSATION_SUMMARY_THRESHOLD * 3;
    const messagesToSummarize = eligibleMessages.slice(0, maxBatchSize);

    const firstMessage = messagesToSummarize[0] || null;
    const lastMessage = messagesToSummarize[messagesToSummarize.length - 1] || null;
    if (!lastMessage?.createdAt) {
      console.log("SUMMARY SKIPPED: threshold not reached", {
        phone: normalizedPhone,
        newEligibleMessages: 0,
      });
      return;
    }

    const latestSummaryUntilMs = timestampToMs(latestSummary?.summarizedUntil);
    const candidateSummaryUntilMs = timestampToMs(lastMessage?.createdAt);

    if (
      latestSummaryUntilMs !== null
      && candidateSummaryUntilMs !== null
      && candidateSummaryUntilMs <= latestSummaryUntilMs
    ) {
      console.log("SUMMARY SKIPPED: threshold not reached", {
        phone: normalizedPhone,
        newEligibleMessages: 0,
      });
      return;
    }

    console.log("SUMMARY GENERATION STARTED", {
      phone: normalizedPhone,
      newEligibleMessages: messagesToSummarize.length,
    });

    const userMemory = await memoryService.getUserMemory(normalizedPhone);
    const summaryText = await createConversationSummaryText({
      previousSummary: latestSummary,
      newMessages: messagesToSummarize,
      userMemory,
    });

    if (!summaryText) {
      throw new Error("Empty summary generated");
    }

    const savedSummary = await memoryService.saveConversationSummary(normalizedPhone, {
      summary: summaryText,
      phone: normalizedPhone,
      messageCount: messagesToSummarize.length,
      previousSummaryId: latestSummary?.id || null,
      summarizedFrom: firstMessage?.createdAt || null,
      summarizedUntil: lastMessage?.createdAt,
      summarizedFromMessageId: firstMessage?.id || null,
      summarizedUntilMessageId: lastMessage?.id || null,
      model: CONVERSATION_SUMMARY_MODEL,
      version: 1,
    });

    console.log("SUMMARY SAVED", {
      phone: normalizedPhone,
      newEligibleMessages: messagesToSummarize.length,
      summaryId: savedSummary?.id || null,
    });
  } catch (error) {
    console.log("SUMMARY FAILED", {
      phone: normalizedPhone,
      newEligibleMessages,
      error: error?.message || error,
    });
  } finally {
    activeSummaryJobs.delete(normalizedPhone);
  }
}

function isPnJid(jid = "") {
  return String(jid).endsWith("@s.whatsapp.net");
}

function isLidJid(jid = "") {
  return String(jid).endsWith("@lid") || String(jid).endsWith("@hosted.lid");
}

async function resolvePhoneFromMessageKey(msg, socket) {
  const key = msg?.key || {};
  const remoteJid = String(key.remoteJid || "");
  const remoteJidAlt = String(key.remoteJidAlt || "");
  const participant = String(key.participant || "");
  const participantAlt = String(key.participantAlt || "");

  const pnCandidate =
    (isPnJid(remoteJidAlt) && remoteJidAlt) ||
    (isPnJid(participantAlt) && participantAlt) ||
    (isPnJid(remoteJid) && remoteJid) ||
    (isPnJid(participant) && participant) ||
    "";

  if (pnCandidate) {
    return normalizePhone(pnCandidate);
  }

  const lidCandidates = [remoteJidAlt, participantAlt, remoteJid, participant].filter(isLidJid);
  const lidMapping = socket?.signalRepository?.lidMapping;

  if (lidMapping && lidCandidates.length) {
    for (const lidJid of lidCandidates) {
      try {
        const mappedPnJid = await lidMapping.getPNForLID(lidJid);
        if (isPnJid(mappedPnJid)) {
          return normalizePhone(mappedPnJid);
        }
      } catch (error) {
        console.log("⚠️ LID mapping lookup failed:", error?.message || error);
      }
    }
  }

  return "";
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
  const normalizedIngredients = normalizedAnalysis.ingredients.map((item) => normalizeIngredientForStorage(item));

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
  if (normalizedAnalysis.totalProteinGrams !== null && normalizedAnalysis.totalProteinGrams !== undefined) {
    entry.protein = normalizedAnalysis.totalProteinGrams;
  }
  if (normalizedAnalysis.totalCarbohydratesGrams !== null && normalizedAnalysis.totalCarbohydratesGrams !== undefined) {
    entry.carbs = normalizedAnalysis.totalCarbohydratesGrams;
  }
  if (normalizedAnalysis.totalFatGrams !== null && normalizedAnalysis.totalFatGrams !== undefined) {
    entry.fat = normalizedAnalysis.totalFatGrams;
  }

  return entry;
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

  if (!normalizedPhone) {
    throw new Error("Missing resolved phone for upload");
  }

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
  phone,
  mealNote = "",
  analysis = null,
  imageUrl = null,
  mealType = "",
}) {
  const normalizedPhone = normalizePhone(phone);
  const user = await getUserByPhone(normalizedPhone);

  if (!user) {
    console.log("❌ משתמש לא נמצא:", normalizedPhone);
    return false;
  }

  const validMealTypes = ["breakfast", "lunch", "dinner", "snack"];
  if (!validMealTypes.includes(mealType)) {
    console.log("❌ סוג ארוחה לא חוקי:", mealType);
    return false;
  }

  const userRef = db.collection("users").doc(user.id);

  try {
    const entry = buildStoredMealEntry({
      mealType,
      mealName: analysis?.mealName,
      imageUrl,
      analysis,
      source: "whatsapp",
      mealNote,
      phone,
    });

    await userRef.collection("meals").add(entry);

    console.log("✅ ארוחה נשמרה עבור user:", user.id, "סוג:", mealType);
    console.log("MEAL ANALYSIS SAVED", {
      ingredientCount: Array.isArray(entry.ingredients) ? entry.ingredients.length : 0,
      confidence: entry.analysis?.confidence ?? null,
    });
    return true;
  } catch (error) {
    console.log("❌ שגיאה בשמירת ארוחה:", error?.message || error);
    return false;
  }
}

// =====================
// Packaged Product Lookup (Open Food Facts)
// =====================
const PRODUCT_CANCELLATION_WORDS = ["לא", "ביטול", "בטל", "עזוב"];

const BARCODE_READ_FAILED_HEBREW = `לא הצלחתי לקרוא את הברקוד.

כדי שאוכל לזהות את המוצר בצורה מדויקת, צלמי את הברקוד מקרוב:

• הברקוד צריך להיות ישר מול המצלמה.
• כל הברקוד צריך להופיע בתמונה.
• חשוב שהתמונה תהיה חדה ובתאורה טובה.
• רצוי לצלם רק את הברקוד, בלי כל האריזה.

לאחר מכן שלחי את התמונה שוב.`;

const BARCODE_MODE_ACTIVATED_HEBREW = `שלחי עכשיו צילום ישר וברור של הברקוד בלבד.

חשוב שכל הפסים והמספרים יופיעו בתמונה, בלי טשטוש ובתאורה טובה.`;

const PACKAGED_PRODUCT_DETECTED_HEBREW = `נראה שזה מוצר ארוז 📦

כדי לזהות את המוצר בצורה מדויקת ולקבל את הערכים התזונתיים הנכונים, שלחי צילום ברור וישר של הברקוד שעל האריזה.

חשוב שכל הפסים והמספרים יופיעו בתמונה, בלי טשטוש ובתאורה טובה.`;

const NON_FOOD_IMAGE_HEBREW =
  "נראה שזו אינה תמונה של מזון. אפשר לשלוח תמונה של ארוחה, מוצר מזון או ברקוד.";

const LOW_CONFIDENCE_FOOD_IMAGE_HEBREW =
  "לא הצלחתי לזהות בוודאות שמדובר במזון. אפשר לצלם שוב כשהארוחה או המוצר מופיעים בבירור.";

function isCancellationMessage(text = "") {
  const normalized = String(text || "").trim();
  return PRODUCT_CANCELLATION_WORDS.some(
    (word) => normalized === word || normalized.startsWith(`${word} `) || normalized.startsWith(`${word},`)
  );
}

function isPositiveConfirmation(text = "") {
  const normalized = String(text || "").trim();
  return normalized === "כן" || normalized.startsWith("כן ") || normalized.startsWith("כן,") || normalized.startsWith("כן.");
}

function shouldStartProductLookup(text = "") {
  return hasExplicitBarcodeIntent(text);
}

function buildProductAnalysisForStorage(product, calculation) {
  const quantityText =
    calculation.amountType === "package_fraction"
      ? formatPackageFractionLabel(calculation.packageFraction)
      : `${calculation.weightGrams} גרם`;

  const ingredient = {
    name: product.name,
    estimatedQuantity: quantityText,
    estimatedQuantityGrams: calculation.weightGrams,
    calories: calculation.calories,
    proteinGrams: calculation.proteinGrams,
    carbohydratesGrams: calculation.carbohydratesGrams,
    fatGrams: calculation.fatGrams,
    confidence: 1,
  };

  return {
    mealName: product.name,
    description: product.brand ? `${product.name} - ${product.brand}` : product.name,
    totalEstimatedQuantityGrams: calculation.weightGrams,
    totalCalories: calculation.calories,
    totalProteinGrams: calculation.proteinGrams,
    totalCarbohydratesGrams: calculation.carbohydratesGrams,
    totalFatGrams: calculation.fatGrams,
    confidence: 1,
    estimationNotes: ["מבוסס על נתוני מאגר Open Food Facts, לא הערכת תמונה."],
    ingredients: [ingredient],
  };
}

async function saveProductMealEntry({ phone, product, calculation, mealType }) {
  const normalizedPhone = normalizePhone(phone);
  const user = await getUserByPhone(normalizedPhone);

  if (!user) {
    console.log("❌ משתמש לא נמצא (מוצר ארוז):", normalizedPhone);
    return false;
  }

  const validMealTypes = ["breakfast", "lunch", "dinner", "snack"];
  if (!validMealTypes.includes(mealType)) {
    console.log("❌ סוג ארוחה לא חוקי (מוצר ארוז):", mealType);
    return false;
  }

  const userRef = db.collection("users").doc(user.id);

  try {
    const analysis = buildProductAnalysisForStorage(product, calculation);
    const entry = buildStoredMealEntry({
      mealType,
      mealName: analysis.mealName,
      imageUrl: product.imageUrl || "",
      analysis,
      source: "whatsapp",
      phone,
    });

    entry.createdAt = FieldValue.serverTimestamp();
    entry.sourceType = "OPEN_FOOD_FACTS";
    entry.productBarcode = product.barcode;
    entry.productName = product.name;
    entry.productBrand = product.brand;
    entry.consumedWeightGrams = calculation.weightGrams;
    entry.packageFraction = calculation.packageFraction;
    entry.nutritionPer100g = product.nutritionPer100g;
    entry.calculatedNutrition = calculation;
    entry.sourceLastModifiedAt = product.lastModifiedAt;
    entry.sourceQualityTags = product.qualityTags || [];
    entry.isEstimated = false;
    entry.isDatabaseReported = true;

    await userRef.collection("meals").add(entry);

    console.log("✅ מוצר ארוז נשמר עבור user:", user.id, "סוג:", mealType);
    return true;
  } catch (error) {
    console.log("❌ שגיאה בשמירת מוצר ארוז:", error?.message || error);
    return false;
  }
}

async function startProductLookupFlow({ sock, from, cleanText }) {
  const candidate = findBarcodeCandidate(cleanText);

  if (!candidate) {
    pending.set(from, { step: "awaiting_product_barcode", createdAt: Date.now() });
    await sock.sendMessage(from, { text: BARCODE_MODE_ACTIVATED_HEBREW });
    return;
  }

  await lookupAndRespondWithProduct({ sock, from, barcode: candidate });
}

async function lookupAndRespondWithProduct({ sock, from, barcode }) {
  const result = await getProductByBarcode(barcode);

  if (!result.found) {
    if (result.errorCode === "PRODUCT_LOOKUP_FAILED") {
      pending.delete(from);
      await sock.sendMessage(from, { text: PRODUCT_LOOKUP_UNAVAILABLE_HEBREW });
      return;
    }

    if (result.errorCode === "PRODUCT_NOT_FOUND") {
      pending.delete(from);
      await sock.sendMessage(from, { text: PRODUCT_NOT_FOUND_HEBREW });
      return;
    }

    // Invalid barcode format/length — let the user retry rather than failing hard.
    pending.set(from, { step: "awaiting_product_barcode", createdAt: Date.now() });
    await sock.sendMessage(from, { text: INVALID_BARCODE_HEBREW });
    return;
  }

  const product = result.product;

  if (!hasUsableCoreNutrition(product)) {
    pending.delete(from);
    await sock.sendMessage(from, { text: PRODUCT_INCOMPLETE_HEBREW });
    return;
  }

  pending.set(from, { step: "awaiting_product_amount", product, createdAt: Date.now() });
  await sock.sendMessage(from, { text: formatProductNutritionForUser(product) });
}

async function handleProductBarcodeInput({ sock, from, cleanText }) {
  if (isCancellationMessage(cleanText)) {
    pending.delete(from);
    await sock.sendMessage(from, { text: "בסדר, ביטלתי את חיפוש המוצר." });
    return;
  }

  const candidate = findBarcodeCandidate(cleanText) || cleanText;
  await lookupAndRespondWithProduct({ sock, from, barcode: candidate });
}

async function handleProductAmountInput({ sock, from, cleanText, pendingEntry }) {
  if (isCancellationMessage(cleanText)) {
    pending.delete(from);
    await sock.sendMessage(from, { text: "בסדר, לא הוספתי את המוצר." });
    return;
  }

  const parsed = parseProductAmountInput(cleanText);

  if (parsed.type === "unsupported_unit") {
    await sock.sendMessage(from, {
      text: "כדי לחשב בצורה אמינה אני צריכה משקל בגרמים, או חלק מהאריזה אם משקל האריזה ידוע.",
    });
    return;
  }

  if (parsed.type === "ambiguous") {
    await sock.sendMessage(from, {
      text: "לא הבנתי כמה נאכל. אפשר לכתוב, למשל: 125 גרם, חצי אריזה, או אריזה שלמה.",
    });
    return;
  }

  const product = pendingEntry.product;
  const calcResult =
    parsed.type === "grams"
      ? calculateNutritionForWeight(product.nutritionPer100g, parsed.grams)
      : calculateNutritionForPackageFraction(product, parsed.fraction);

  if (!calcResult.ok) {
    if (calcResult.errorCode === "PACKAGE_WEIGHT_IS_VOLUME") {
      await sock.sendMessage(from, { text: PACKAGE_WEIGHT_IS_VOLUME_HEBREW });
      return;
    }

    if (calcResult.errorCode === "UNKNOWN_PACKAGE_WEIGHT") {
      await sock.sendMessage(from, {
        text: "לא ידוע לי משקל האריזה של המוצר הזה, ולכן אי אפשר לחשב לפי חלק מהאריזה. אפשר לכתוב כמות בגרמים?",
      });
      return;
    }

    await sock.sendMessage(from, {
      text: "הכמות שכתבת לא תקינה. אפשר לכתוב מספר גרמים סביר, או חלק מהאריזה?",
    });
    return;
  }

  pending.set(from, {
    step: "awaiting_product_confirmation",
    product,
    calculation: calcResult.result,
    createdAt: Date.now(),
  });

  await sock.sendMessage(from, {
    text: formatProductConfirmationSummary(product, calcResult.result),
  });
}

async function handleProductConfirmationInput({ sock, from, cleanText, pendingEntry }) {
  if (isCancellationMessage(cleanText)) {
    pending.delete(from);
    await sock.sendMessage(from, { text: "בסדר, לא הוספתי את המוצר." });
    return;
  }

  if (!isPositiveConfirmation(cleanText)) {
    await sock.sendMessage(from, { text: "אפשר לענות כן או לא?" });
    return;
  }

  pending.set(from, {
    step: "awaiting_product_meal_type",
    product: pendingEntry.product,
    calculation: pendingEntry.calculation,
    createdAt: Date.now(),
  });

  await sock.sendMessage(from, {
    text: "איזו ארוחה זו הייתה?\nכתבי רק אחת מהאפשרויות:\nבוקר\nצהריים\nערב\nביניים",
  });
}

async function handleProductMealTypeInput({ sock, from, resolvedPhone, cleanText, pendingEntry }) {
  if (isCancellationMessage(cleanText)) {
    pending.delete(from);
    await sock.sendMessage(from, { text: "בסדר, לא הוספתי את המוצר." });
    return;
  }

  const mealType = normalizeMealType(cleanText);

  if (!mealType) {
    await sock.sendMessage(from, {
      text: "לא הבנתי את סוג הארוחה.\nכתבי רק:\nבוקר\nצהריים\nערב\nביניים",
    });
    return;
  }

  const saved = await saveProductMealEntry({
    phone: resolvedPhone,
    product: pendingEntry.product,
    calculation: pendingEntry.calculation,
    mealType,
  });

  pending.delete(from);

  await sock.sendMessage(from, {
    text: saved
      ? "✅ המוצר נוסף לארוחה ונשמר ביומן"
      : "לא מצאתי משתמש באתר עם מספר הטלפון הזה. תוודאי שבאתר נשמר אותו מספר טלפון בדיוק.",
  });
}

// =====================
// Nutrition Targets (deterministic calorie/protein calculator)
// =====================
//
// User asks a personal "how much should I eat" question
//   -> detectNutritionTargetRequest() classifies it (deterministic, no LLM)
//   -> getStoredNutritionProfileLayers() reads the two STORED layers: the
//      web app's onboarding data (users/{uid}: gender/birthDate/height/
//      weight, via the existing getUserByPhone()) and anything already
//      collected for this purpose over WhatsApp (userMemories/{phone}
//      .profile.targetProfile — a new, additive sub-object; it does not
//      touch MEMORY_CATEGORIES or merge.helper.js at all)
//   -> mergeNutritionProfile() (nutrition-targets.service.js) combines that
//      with the in-session pending layer and whatever was just parsed from
//      the CURRENT message, with strict last-write-wins priority: web <
//      stored (WhatsApp) < pending (this session, prior turns) < current
//      message. A value the user just stated can therefore never be
//      shadowed by an older stored value — see mergeNutritionProfile's
//      docstring for the full rationale.
//   -> only the still-missing fields are asked for, via `pending`
//   -> every turn's newly-parsed fields are persisted to Firestore
//      immediately (not only once the flow completes), so a corrected
//      value is never lost even if the user abandons the flow.
//   -> once complete, nutrition-targets.service.js (pure, deterministic,
//      no LLM) computes the result, which is relayed to the user.
//
// A message containing a correction OUTSIDE any active flow (e.g. "אני
// שוקלת 65" sent on its own) is caught separately by
// handleStandaloneProfileUpdate() below, so it is saved immediately
// instead of falling through to the unconstrained generic chat function —
// this was the root cause of a real stale-data bug: such a message used to
// reach generateReply(), which could claim ("saved!") without ever writing
// to targetProfile.

function computeAgeFromBirthDate(birthDateStr) {
  if (!birthDateStr) return null;
  const parsed = new Date(birthDateStr);
  if (Number.isNaN(parsed.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - parsed.getFullYear();
  const monthDiff = now.getMonth() - parsed.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < parsed.getDate())) {
    age -= 1;
  }

  // A computed age below 5 is never a real user's age for this app — it's
  // a malformed/placeholder birthDate value. Treating it as "unknown"
  // (null) here means the caller correctly falls back to
  // DEFAULT_CALCULATION_AGE instead of feeding an implausible age into the
  // formula. This is a data-plausibility check, not an eligibility gate.
  return age >= 5 && age <= 130 ? age : null;
}

async function getWebOnboardingProfileFields(resolvedPhone) {
  try {
    const user = await getUserByPhone(resolvedPhone);
    if (!user) return {};

    const fields = {};

    const sex = normalizeSex(user.gender);
    if (sex) fields.sex = sex;

    if (Number.isFinite(Number(user.height))) fields.heightCm = Number(user.height);
    if (Number.isFinite(Number(user.weight))) fields.weightKg = Number(user.weight);

    const age = computeAgeFromBirthDate(user.birthDate);
    if (age !== null) fields.age = age;

    return fields;
  } catch (error) {
    console.log("NUTRITION TARGET WEB PROFILE LOOKUP FAILED", { error: error?.message || error });
    return {};
  }
}

function buildSafetyContextTextFromMemory(userMemory) {
  const profile = userMemory?.profile;
  if (!profile || typeof profile !== "object") return "";

  const parts = [];
  for (const field of ["importantNotes", "dietaryRestrictions", "allergies", "sensitivities", "goals"]) {
    const value = profile[field];
    if (Array.isArray(value) && value.length) parts.push(value.join(", "));
  }

  return parts.join(" | ");
}

// Reads the two STORED profile layers fresh from Firestore every time it is
// called (never cached across turns) — see the module comment above for why
// that matters: a mid-session correction saved by
// handleStandaloneProfileUpdate() or a prior turn of this same flow must be
// visible to the very next merge, not shadowed by a snapshot taken earlier.
async function getStoredNutritionProfileLayers(resolvedPhone) {
  const memoryService = await getMemoryService();
  const userMemory = memoryService
    ? await memoryService.getUserMemory(resolvedPhone).catch(() => null)
    : null;

  // Stored targetProfile values are re-normalized through the same
  // canonical normalizers used for fresh input, not trusted as-is. This
  // matters for data written before a prior activity-tier rename (e.g. the
  // now-removed "active" tier) — without this, a legacy non-canonical
  // value would pass through unchanged and crash the calculator with
  // INVALID_ACTIVITY_LEVEL instead of being treated as simply unknown.
  const rawStoredTargetProfile =
    userMemory?.profile?.targetProfile && typeof userMemory.profile.targetProfile === "object"
      ? userMemory.profile.targetProfile
      : {};
  const storedTargetProfile = { ...rawStoredTargetProfile };
  if ("activityLevel" in storedTargetProfile) {
    const normalized = normalizeActivityLevel(storedTargetProfile.activityLevel);
    if (normalized) storedTargetProfile.activityLevel = normalized;
    else delete storedTargetProfile.activityLevel;
  }
  if ("sex" in storedTargetProfile) {
    const normalized = normalizeSex(storedTargetProfile.sex);
    if (normalized) storedTargetProfile.sex = normalized;
    else delete storedTargetProfile.sex;
  }
  if ("goal" in storedTargetProfile) {
    const normalized = normalizeGoal(storedTargetProfile.goal);
    if (normalized) storedTargetProfile.goal = normalized;
    else delete storedTargetProfile.goal;
  }

  const webProfile = await getWebOnboardingProfileFields(resolvedPhone);
  const safetyContext = buildSafetyContextTextFromMemory(userMemory);

  return { webProfile, storedTargetProfile, safetyContext };
}

// Persists newly-known fields to userMemories/{phone}.profile.targetProfile
// immediately (called on every turn that yields new info, not only once a
// flow completes) so a corrected value can never be lost or superseded by
// an older stored value on a later, separate turn.
//
// `age` is deliberately never persisted here, even when volunteered — see
// bot/knowledge/00-scope-and-safety.md: age is never saved to the profile,
// only ever used as transient in-memory input to a single calculation.
// Returns { ok, savedFields } — savedFields contains ONLY fields that were
// re-read back from Firestore after the write and verified to match what
// was intended (never just "what we attempted to write"). Callers that
// confirm a save to the user (handleStandaloneProfileUpdate) MUST build
// their confirmation text from `savedFields`, never from the raw input —
// a field must never be claimed as saved unless it was parsed, normalized,
// validated, persisted, AND verified.
async function saveTargetProfileFields(resolvedPhone, newFields, { messageId = "" } = {}) {
  const { safetyContext, age, ...fieldsToSave } = newFields || {};
  if (!Object.keys(fieldsToSave).length) return { ok: true, savedFields: {} };

  try {
    const memoryService = await getMemoryService();
    if (!memoryService) return { ok: false, savedFields: {} };

    const userMemory = await memoryService.getUserMemory(resolvedPhone);
    const currentProfile =
      userMemory?.profile && typeof userMemory.profile === "object" ? userMemory.profile : {};
    const currentTargetProfile =
      currentProfile.targetProfile && typeof currentProfile.targetProfile === "object"
        ? currentProfile.targetProfile
        : {};

    const nextProfile = {
      ...currentProfile,
      targetProfile: {
        ...currentTargetProfile,
        ...fieldsToSave,
        updatedAt: new Date().toISOString(),
      },
    };

    await memoryService.applyIntelligentMemoryUpdate(resolvedPhone, {
      updatedProfile: nextProfile,
      messageId,
      lastUpdatedCategories: ["targetProfile"],
      lastUpdateSource: "nutrition_target_flow",
      memoryVersion: 2,
    });

    // Re-read after writing — never assume a write applied just because it
    // didn't throw. Only fields that verifiably round-trip through
    // Firestore are ever reported back as saved.
    const verifiedUserMemory = await memoryService.getUserMemory(resolvedPhone);
    const verifiedTargetProfile =
      verifiedUserMemory?.profile?.targetProfile && typeof verifiedUserMemory.profile.targetProfile === "object"
        ? verifiedUserMemory.profile.targetProfile
        : {};

    const savedFields = {};
    for (const [field, value] of Object.entries(fieldsToSave)) {
      if (verifiedTargetProfile[field] === value) savedFields[field] = value;
    }
    const allVerified = Object.keys(fieldsToSave).every((field) => field in savedFields);

    if (DEBUG_NUTRITION_TARGET) {
      console.log("NUTRITION TARGET PROFILE SAVE (dev only)", {
        phone: resolvedPhone,
        fieldsSaved: Object.keys(fieldsToSave),
        normalizedValues: fieldsToSave,
        verifiedStoredProfile: verifiedTargetProfile,
      });
    }
    if (!allVerified) {
      console.log("NUTRITION TARGET PROFILE SAVE NOT FULLY VERIFIED", {
        attempted: fieldsToSave,
        verified: savedFields,
      });
    }

    return { ok: allVerified, savedFields };
  } catch (error) {
    console.log("NUTRITION TARGET PROFILE SAVE FAILED", { error: error?.message || error });
    return { ok: false, savedFields: {} };
  }
}

function requiredNutritionFieldsForRequestType(requestType) {
  if (requestType === "protein") return REQUIRED_PROTEIN_FIELDS;
  if (requestType === "both") {
    return Array.from(new Set([...REQUIRED_CALORIE_FIELDS, ...REQUIRED_PROTEIN_FIELDS]));
  }
  return REQUIRED_CALORIE_FIELDS;
}

// Dev-only visibility into exactly which values were used for a calculation
// and where each one came from — never sent to the WhatsApp user. Enabled
// via DEBUG_NUTRITION_TARGET=true, mirroring the existing
// DEBUG_MEAL_ANALYSIS pattern in services/meal-analysis.js.
const DEBUG_NUTRITION_TARGET = process.env.DEBUG_NUTRITION_TARGET === "true";

// Logged exactly once per calculation, right before/around the actual
// compute call, with the precise shape requested: the effective profile
// (canonical field names only), where each field came from, and the
// resulting bmr/maintenanceCalories/targetCalories. Never sent to the
// WhatsApp user — console-only, gated by DEBUG_NUTRITION_TARGET.
function logNutritionTargetCalculation({ requestType, profile, fieldSources, missingFields, result }) {
  if (!DEBUG_NUTRITION_TARGET) return;

  const calorieResult = requestType === "both" ? result.calories : result;
  const calorieOk = calorieResult?.ok && calorieResult.requestType === "calories";

  console.log("NUTRITION TARGET CALCULATION (dev only, never shown to the user)", {
    requestType,
    profile: {
      weightKg: profile.weightKg,
      heightCm: profile.heightCm,
      sex: profile.sex,
      activityLevel: profile.activityLevel,
      goal: profile.goal,
    },
    fieldSources,
    missingFields: missingFields || [],
    bmr: calorieOk ? calorieResult.bmr : undefined,
    maintenanceCalories: calorieOk ? calorieResult.maintenanceCalories : undefined,
    targetCalories: calorieOk ? calorieResult.targetCalories : undefined,
  });
}

async function respondWithNutritionTargetResult({
  sock,
  from,
  resolvedPhone,
  requestType,
  profile,
  fieldSources,
  messageId,
}) {
  const result = getNutritionTarget({ requestType, profile });

  // For requestType "both" the outer envelope is always {ok:true} (it
  // wraps two independent sub-results) — the calorie sub-result is the
  // stricter one (protein alone can't reveal an unsafe condition or an
  // invalid sex/activity value), so it's checked as the primary signal.
  // Without this, an unsafe-condition block on a "both" request would be
  // silently swallowed instead of shown to the user.
  const primaryResult = requestType === "both" ? result.calories : result;

  if (!primaryResult?.ok) {
    if (primaryResult?.errorCode === "UNSAFE_CONDITION") {
      await sock.sendMessage(from, { text: primaryResult.message });
      return;
    }

    // By this point every field was already validated as present AND
    // plausible by parseNutritionProfileFields() before ever reaching
    // here (see its present/valid/absent distinction), so this path
    // should be genuinely unreachable in normal operation — a required
    // field that IS present but fails validation here can only mean
    // corrupted/unexpected stored data. Log the exact error so it can be
    // investigated, rather than telling the user their input was invalid
    // (it wasn't — theirs was already validated at parse time).
    console.log("NUTRITION TARGET UNEXPECTED CALCULATION FAILURE", {
      requestType,
      errorCode: primaryResult?.errorCode,
      profile,
    });
    await sock.sendMessage(from, {
      text: "הייתה לי תקלה בחישוב. אפשר לנסות שוב עוד רגע?",
    });
    return;
  }

  logNutritionTargetCalculation({ requestType, profile, fieldSources, missingFields: [], result });

  const replyText =
    requestType === "both"
      ? [
          result.protein?.ok ? formatNutritionTargetReplyHebrew(result.protein) : null,
          result.calories?.ok ? formatNutritionTargetReplyHebrew(result.calories) : null,
        ]
          .filter(Boolean)
          .join("\n\n---\n\n")
      : formatNutritionTargetReplyHebrew(result);

  await sock.sendMessage(from, { text: replyText });

  // No persistence here: every turn that yielded new info has already
  // saved it immediately, in startNutritionTargetFlow /
  // handleNutritionTargetInfoInput — see the module comment above for why
  // incremental, per-turn persistence (rather than only-at-completion) is
  // required to avoid losing a correction if the flow is abandoned.
}

// A single, explicit merge call site for this flow: given the two stored
// layers plus the in-session pending layer plus whatever was parsed from
// the current message, returns the effective profile AND a source map
// (nutrition-targets.service.js's mergeNutritionProfile — last-write-wins,
// current message always highest priority). `safetyContext` is appended
// separately since it's a free-text accumulator, not a scalar field.
function buildEffectiveNutritionProfile({ webProfile, storedTargetProfile, pendingProfile, currentMessageProfile, priorSafetyContext, cleanText }) {
  const { profile, fieldSources } = mergeNutritionProfile({
    webProfile,
    storedTargetProfile,
    pendingProfile,
    currentMessageProfile,
  });
  profile.safetyContext = [priorSafetyContext, cleanText].filter(Boolean).join(" | ");
  return { profile, fieldSources };
}

// Turns invalidFields (from parseNutritionProfileFields) into the specific
// Hebrew explanations defined in nutrition-targets.service.js — never a
// generic "couldn't calculate" message. Returns "" if nothing to report.
function buildInvalidFieldsMessage(invalidFields = {}) {
  const messages = Object.keys(invalidFields)
    .map((field) => getInvalidFieldMessage(field))
    .filter(Boolean);
  return messages.join("\n\n");
}

async function startNutritionTargetFlow({ sock, from, resolvedPhone, cleanText, messageId }) {
  const { requestType } = detectNutritionTargetRequest(cleanText);
  const { webProfile, storedTargetProfile, safetyContext } = await getStoredNutritionProfileLayers(resolvedPhone);
  const { fields: currentMessageProfile, invalidFields } = parseNutritionProfileFields(cleanText);

  const { profile: mergedProfile, fieldSources } = buildEffectiveNutritionProfile({
    webProfile,
    storedTargetProfile,
    pendingProfile: {},
    currentMessageProfile,
    priorSafetyContext: safetyContext,
    cleanText,
  });

  // Age plays no part in this check — only explicit safety keywords
  // (pregnancy, breastfeeding, kidney/liver disease, eating disorder).
  const unsafeReasons = detectUnsafeConditions({ freeText: mergedProfile.safetyContext });

  if (unsafeReasons.length) {
    await sock.sendMessage(from, { text: getUnsafeConditionMessage(unsafeReasons) });
    return;
  }

  // Persist whatever the user just told us immediately — a value from the
  // current message must never be lost even if the flow is abandoned.
  // Only VALID fields are ever in currentMessageProfile; a rejected value
  // (see invalidFields) is never merged or saved.
  await saveTargetProfileFields(resolvedPhone, currentMessageProfile, { messageId });

  const invalidMessage = buildInvalidFieldsMessage(invalidFields);
  const requiredFields = requiredNutritionFieldsForRequestType(requestType);
  const missingFields = getMissingNutritionTargetFields(mergedProfile, requiredFields);

  if (!missingFields.length) {
    await respondWithNutritionTargetResult({
      sock,
      from,
      resolvedPhone,
      requestType,
      profile: mergedProfile,
      fieldSources,
      messageId,
    });
    return;
  }

  pending.set(from, {
    step: "awaiting_nutrition_target_info",
    requestType,
    // Fields collected so far THIS session — merged as the "pending" layer
    // (below the current message, above stored/web) on every future turn.
    pendingProfile: currentMessageProfile,
    missingFields,
    createdAt: Date.now(),
  });

  const questionText = buildMissingFieldsQuestion(missingFields, requestType);
  await sock.sendMessage(from, {
    text: invalidMessage ? `${invalidMessage}\n\n${questionText}` : questionText,
  });
}

async function handleNutritionTargetInfoInput({ sock, from, resolvedPhone, cleanText, pendingEntry, messageId }) {
  if (isCancellationMessage(cleanText)) {
    pending.delete(from);
    await sock.sendMessage(from, { text: "בסדר, לא נמשיך עם החישוב כרגע." });
    return;
  }

  const { requestType, pendingProfile, missingFields } = pendingEntry;

  // When exactly one field remains, interpret a bare terse reply ("170",
  // "17") in that field's context (parseSingleFieldAnswerResult falls back
  // to a bare-number reading when the general parser finds nothing). This
  // is also where an out-of-range bare reply ("17" for height) is caught
  // and reported specifically, instead of being silently dropped.
  let currentMessageProfile = {};
  let invalidFieldMessages = [];

  if (missingFields.length === 1) {
    const field = missingFields[0];
    const result = parseSingleFieldAnswerResult(field, cleanText);
    if (result.valid) {
      currentMessageProfile = { [field]: result.value };
    } else if (result.present) {
      const specificMessage = getInvalidFieldMessage(field);
      if (specificMessage) invalidFieldMessages.push(specificMessage);
    }
  } else {
    const parsed = parseNutritionProfileFields(cleanText);
    currentMessageProfile = parsed.fields;
    invalidFieldMessages = Object.keys(parsed.invalidFields)
      .map((invalidField) => getInvalidFieldMessage(invalidField))
      .filter(Boolean);
  }

  // Re-read the stored layers fresh on every turn (not a snapshot from when
  // the flow started) so a correction saved mid-session — e.g. via
  // handleStandaloneProfileUpdate() — is picked up immediately rather than
  // being shadowed by stale data captured at flow start.
  const { webProfile, storedTargetProfile, safetyContext } = await getStoredNutritionProfileLayers(resolvedPhone);

  const { profile: mergedProfile, fieldSources } = buildEffectiveNutritionProfile({
    webProfile,
    storedTargetProfile,
    pendingProfile,
    currentMessageProfile,
    priorSafetyContext: safetyContext,
    cleanText,
  });

  // Age plays no part in this check — only explicit safety keywords
  // (pregnancy, breastfeeding, kidney/liver disease, eating disorder).
  const unsafeReasons = detectUnsafeConditions({ freeText: mergedProfile.safetyContext });

  if (unsafeReasons.length) {
    pending.delete(from);
    await sock.sendMessage(from, { text: getUnsafeConditionMessage(unsafeReasons) });
    return;
  }

  await saveTargetProfileFields(resolvedPhone, currentMessageProfile, { messageId });

  const requiredFields = requiredNutritionFieldsForRequestType(requestType);
  const stillMissing = getMissingNutritionTargetFields(mergedProfile, requiredFields);

  if (stillMissing.length) {
    // A mid-flow reply that itself reads as a coherent nutrition-target
    // request (e.g. the user simply re-asks "כמה קלוריות אני צריכה
    // ביום?" again) is not gibberish — it just didn't add any new field.
    // Only prefix "לא הבנתי" when the reply is neither a recognized new
    // field NOR a recognizable restatement of the request itself.
    const isRecognizableRestatement = detectNutritionTargetRequest(cleanText).isNutritionTargetRequest;
    const understoodNothingNew =
      Object.keys(currentMessageProfile).length === 0 &&
      invalidFieldMessages.length === 0 &&
      !isRecognizableRestatement;
    const questionText = buildMissingFieldsQuestion(stillMissing, requestType);

    let text;
    if (invalidFieldMessages.length) {
      text = `${invalidFieldMessages.join("\n\n")}\n\n${questionText}`;
    } else if (understoodNothingNew) {
      text = `לא הבנתי את התשובה.\n\n${questionText}`;
    } else {
      text = questionText;
    }

    await sock.sendMessage(from, { text });

    pending.set(from, {
      ...pendingEntry,
      pendingProfile: { ...pendingProfile, ...currentMessageProfile },
      missingFields: stillMissing,
    });
    return;
  }

  pending.delete(from);
  await respondWithNutritionTargetResult({
    sock,
    from,
    resolvedPhone,
    requestType,
    profile: mergedProfile,
    fieldSources,
    messageId,
  });
}

// ---------------------------------------------------------------------
// Standalone profile-update handler: catches a bare corrective statement
// sent OUTSIDE any active nutrition-target flow (e.g. "אני שוקלת 65" on its
// own, with no active `pending` entry and no full calculation request) —
// including one that's INVALID ("גובה 17", "אני שוקלת 600"), which must
// also be intercepted here rather than falling through to generic chat.
//
// This is the fix for a real reported bug: such a message previously
// matched no routing pattern at all, so it fell through to the
// unconstrained generic chat function (generateReply), which could
// fabricate a "saved!"/"the height was saved" confirmation without ever
// writing to userMemories/{phone}.profile.targetProfile — the user's
// corrected value was silently lost, and the next calculation either used
// the old stored value or failed outright with a generic error.
//
// Deliberately requires at least one of weightKg / heightCm / activityLevel
// / goal — as a valid OR a rejected-invalid attempt — to trigger; a bare
// `sex`-only parse is NOT enough on its own, since incidental
// grammatically-gendered phrasing unrelated to this feature (e.g. "אני בת
// 25 גרה בתל אביב") would otherwise be misdetected as a profile-update
// message. `sex` is still saved if it co-occurs with a genuine trigger
// field.
//
// A field is NEVER reported as saved unless saveTargetProfileFields()
// verified it round-tripped through Firestore — see that function's
// `savedFields` return value, which is what confirmedLines below is built
// from, not the raw parsed input.
// ---------------------------------------------------------------------
const STANDALONE_PROFILE_UPDATE_TRIGGER_FIELDS = ["weightKg", "heightCm", "activityLevel", "goal"];

function isStandaloneProfileUpdateMessage(fields, invalidFields) {
  return STANDALONE_PROFILE_UPDATE_TRIGGER_FIELDS.some(
    (field) => fields[field] !== undefined || invalidFields[field] !== undefined
  );
}

const PROFILE_FIELD_CONFIRMATION_LABEL_HEBREW = {
  weightKg: (v) => `משקל: ${v} ק"ג`,
  heightCm: (v) => `גובה: ${v} ס"מ`,
  activityLevel: (v) => `רמת פעילות: ${ACTIVITY_LEVEL_SHORT_LABEL_HEBREW[v] || v}`,
  sex: () => null, // sex is saved but not surfaced in the confirmation line
  goal: () => null, // goal is saved but not surfaced in the confirmation line
};

async function handleStandaloneProfileUpdate({ sock, from, resolvedPhone, cleanText, messageId }) {
  const { fields, invalidFields } = parseNutritionProfileFields(cleanText);
  if (!isStandaloneProfileUpdateMessage(fields, invalidFields)) return false;

  const hasFieldsToSave = Object.keys(fields).length > 0;
  const saveResult = hasFieldsToSave
    ? await saveTargetProfileFields(resolvedPhone, fields, { messageId })
    : { ok: true, savedFields: {} };

  const parts = [];

  if (Object.keys(saveResult.savedFields).length) {
    const confirmedLines = Object.entries(saveResult.savedFields)
      .map(([field, value]) => PROFILE_FIELD_CONFIRMATION_LABEL_HEBREW[field]?.(value) || null)
      .filter(Boolean);

    parts.push(
      confirmedLines.length
        ? `עדכנתי את הנתונים שלך:\n${confirmedLines.map((line) => `• ${line}`).join("\n")}`
        : "עדכנתי את הנתונים שלך."
    );
  } else if (hasFieldsToSave && !saveResult.ok) {
    // Parsed and validated, but the write couldn't be verified — never
    // claim it was saved when it wasn't.
    parts.push("לא הצלחתי לשמור את הנתונים כרגע. אפשר לנסות שוב עוד רגע?");
  }

  const invalidMessage = buildInvalidFieldsMessage(invalidFields);
  if (invalidMessage) parts.push(invalidMessage);

  await sock.sendMessage(from, { text: parts.join("\n\n") });
  return true;
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

    console.log("MEAL ANALYSIS SAVED", {
      ingredientCount: Array.isArray(entry.ingredients) ? entry.ingredients.length : 0,
      confidence: entry.analysis?.confidence ?? null,
    });

    res.status(201).json({
      id: savedDoc.id,
      ok: true,
    });
  } catch (error) {
    console.log("❌ diary save endpoint failed:", error?.message || error);
    res.status(500).json({ error: "Failed to save meal in diary" });
  }
});

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
    const parsed = new Date((seconds * 1000) + Math.floor(nanos / 1e6));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  return null;
}

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
    console.log("MEAL EDIT PATCH FAILED", {
      status: 500,
      code: "PATCH_MEAL_FAILED",
    });
    console.log("❌ meal update endpoint failed:", error?.message || error);
    res.status(500).json({ error: "עדכון הארוחה נכשל.", code: "PATCH_MEAL_FAILED" });
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

if (isMainModule) {
  app.listen(PORT, () => {
    console.log(`✅ Web running: http://localhost:${PORT}`);
  });
}

// =====================
// Memory
// =====================
const memory = new Map();
const pending = new Map();
const processedMessageIds = new Map();

const MESSAGE_ID_TTL_MS = 30 * 60 * 1000;
const BOT_SESSION_STARTED_AT_MS = Date.now();

function pruneProcessedMessageIds(now = Date.now()) {
  for (const [id, ts] of processedMessageIds.entries()) {
    if (now - ts > MESSAGE_ID_TTL_MS) {
      processedMessageIds.delete(id);
    }
  }
}

function hasProcessedMessage(msg) {
  const id = msg?.key?.id;
  const jid = msg?.key?.remoteJid || "";
  if (!id) return false;

  const dedupeKey = `${jid}:${id}`;

  const now = Date.now();
  pruneProcessedMessageIds(now);

  if (processedMessageIds.has(dedupeKey)) {
    return true;
  }

  processedMessageIds.set(dedupeKey, now);
  return false;
}

function toTimestampMs(rawTs) {
  if (!rawTs) return null;

  if (typeof rawTs === "number") {
    return rawTs > 1e12 ? rawTs : rawTs * 1000;
  }

  if (typeof rawTs === "object") {
    if (typeof rawTs.toNumber === "function") {
      const n = rawTs.toNumber();
      return n > 1e12 ? n : n * 1000;
    }

    if (typeof rawTs.low === "number") {
      const n = rawTs.low;
      return n > 1e12 ? n : n * 1000;
    }
  }

  return null;
}

function isStaleInboundMessage(msg) {
  const tsMs = toTimestampMs(msg?.messageTimestamp);
  if (!tsMs) return true;

  // Replayed append history is usually older than the current runtime session.
  // Keep a small grace window to avoid clock skew issues.
  return tsMs < BOT_SESSION_STARTED_AT_MS - 60 * 1000;
}

function shouldSkipAsStaleMessage(msg, type) {
  // Only "append" should be filtered for replayed history.
  // "notify" is the primary signal for a new inbound user message.
  if (type !== "append") return false;
  return isStaleInboundMessage(msg);
}

function addToHistory(chatId, role, content) {
  const h = memory.get(chatId) || [];
  h.push({ role, content });
  memory.set(chatId, h.slice(-10));
}

// =====================
// Helpers
// =====================
function shouldIgnoreMessage(msg, type) {
  if (!msg) return true;

  // Ignore messages sent by the bot itself
  if (msg.key?.fromMe) return true;

  const jid = msg.key?.remoteJid || "";

  // Process only direct 1:1 chats.
  // Group traffic causes unrelated events and should never trigger the customer bot flow.
  if (jid.endsWith("@g.us")) return true;

  // Ignore broadcasts and status updates
  if (jid === "status@broadcast") return true;
  if (jid.endsWith("@broadcast")) return true;

  // Ignore protocol/system messages
  if (msg.message?.protocolMessage) return true;
  if (msg.message?.senderKeyDistributionMessage) return true;

  // Ignore if no message object at all
  if (!msg.message) return true;

  // Accept notify + append. Append can include valid new inbound messages
  // depending on connection state and Baileys behavior.
  if (type !== "notify" && type !== "append") {
    return true;
  }

  return false;
}

function getFallbackClarifyingQuestionFromMealName(mealName = "") {
  const text = String(mealName || "").toLowerCase();

  if (text.includes("סלט")) return "האם היה רוטב, שמן או תוספות כמו קרוטונים וגבינה?";
  if (text.includes("פסטה")) return "האם היה רוטב שמנת, שמן, גבינה או חמאה?";
  if (text.includes("טוסט") || text.includes("כריך") || text.includes("סנדוויץ")) {
    return "האם היה רוטב, גבינה, חמאה או ממרח בתוך המנה?";
  }
  if (text.includes("שניצל") || text.includes("צ'יפס") || text.includes("מטוגן")) {
    return "האם זה היה מטוגן בשמן והאם אכלת את כל המנה?";
  }
  if (text.includes("יוגורט") || text.includes("גרנולה") || text.includes("קוואקר")) {
    return "הוספת חלב, יוגורט, דבש או תוספות נוספות?";
  }

  return "יש פרט שיכול לשנות משמעותית את ההערכה, למשל רוטב, שמן, גבינה או גודל מנה?";
}

function getClarificationQuestionFromAnalysis(analysis) {
  const question = String(analysis?.clarificationQuestion || "").trim();
  return question || getFallbackClarifyingQuestionFromMealName(analysis?.mealName);
}

function formatMealAnalysisForUser(analysis) {
  return canonicalAnalysisToLegacyText(analysis);
}

// =====================
// OpenAI helpers
// =====================
async function generateReply(
  chatId,
  userText,
  { currentMessageId = "", currentMessageTimestampMs = null, memoryContextOverride = null } = {}
) {
  const memoryContext = memoryContextOverride || await buildMemoryContext(chatId, {
    currentUserMessage: userText,
    currentMessageId,
    currentMessageTimestampMs,
  });

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
- השתמשי בזיכרון רק כשהוא רלוונטי לבקשה הנוכחית.
- אל תחזרי על עובדות ידועות ללא צורך.
- אל תטעני שיש זיכרון אם הוא לא קיים במפורש.
- אל תמציאי אלרגיות, מטרות, ארוחות או עובדות רפואיות.
- אם ההקשר לא חד-משמעי, שאלי שאלת הבהרה קצרה.
- שמרי על שפה טבעית ושיחתית בעברית.
- לעולם אל תחשפי למשתמש את מבנה הזיכרון הפנימי.
- אל תתני ייעוץ רפואי.
- לעולם אל תחשבי או תמציאי בעצמך יעד קלורי אישי או כמות חלבון אישית מדויקת - אלו מחושבים אך ורק על ידי שירות ייעודי באפליקציה. אם המשתמש/ת שואל/ת "כמה קלוריות/חלבון אני צריכה ביום", או מביע/ה רצון לרדת/לעלות/לשמור על המשקל, בקשי ממנה לשאול/לכתוב זאת כפי שהיא/הוא כתב/ה - הבקשה תטופל אוטומטית על ידי האפליקציה, ואל תנחשי מספר בעצמך.
- לעולם אל תשאלי את המשתמש/ת על גיל, ולעולם אל תזכירי גיל 18, "מתחת לגיל 18", "מעל גיל 18", "קטין/ה" או "מבוגר/ת" בשום הקשר של חישוב תזונתי - זה לא רלוונטי לאף חלק בתהליך הזה ואסור לך להעלות את הנושא בעצמך מכל סיבה.
- לעולם אל תטעני או תרמזי ששמרת, עדכנת או תיעדת נתון כלשהו על המשתמש/ת (משקל, גובה, מין, רמת פעילות, מטרה, או כל פרט אישי אחר) - את/ה לא שומר/ת נתונים כאלה בעצמך בשום מקרה. עדכון נתונים כאלה מתבצע אך ורק דרך תהליך ייעודי באפליקציה, שאמור היה לתפוס הודעות כאלה לפני שהן מגיעות אלייך; אם בכל זאת הגיעה אלייך הודעה כזו, הגיבי בטבעיות בלי לטעון ששמרת משהו.
- לעולם אל תפתחי או תמשיכי בעצמך שיחה מובנית לאיסוף פרטים לצורך חישוב יעד קלורי/חלבון (כלומר אל תשאלי ברצף על משקל, גובה, מין ורמת פעילות כדי לחשב עבור המשתמש/ת) - זהו תהליך נפרד וייעודי באפליקציה.

החזירי תמיד ורק JSON תקין במבנה הבא:
{
  "reply": "string"
}
`.trim(),
    },
    {
      role: "user",
      content: `
[LONG-TERM USER MEMORY]
${formatLongTermMemorySection(memoryContext.longTermMemory)}

[LATEST CONVERSATION SUMMARY]
${memoryContext.latestSummary || "אין סיכום שיחה זמין."}

[RECENT CONVERSATION]
${formatRecentConversationSection(memoryContext.recentMessages)}

[CURRENT USER MESSAGE]
${String(userText || "").trim()}
`.trim(),
    },
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
      reply: rawContent || "תכתבי לי שוב ואנסה לעזור בצורה יותר מדויקת 🙏",
    };
  }

  const reply = String(parsed.reply || "").trim();

  return {
    reply: reply || "תכתבי לי שוב ואנסה לעזור בצורה יותר מדויקת 🙏",
  };
}

async function generateReplyWithNutritionKnowledge(
  chatId,
  userText,
  { currentMessageId = "", currentMessageTimestampMs = null } = {}
) {
  const memoryContext = await buildMemoryContext(chatId, {
    currentUserMessage: userText,
    currentMessageId,
    currentMessageTimestampMs,
  });

  if (isGeneralNutritionQuestion(userText)) {
    const nutritionResult = await getNutritionKnowledgeAnswer({
      question: userText,
      userProfileSummary: formatLongTermMemorySection(memoryContext.longTermMemory),
      memorySummary: memoryContext.latestSummary || "",
      mealInfoSummary: "Use any meal totals provided by the app as authoritative.",
      openaiClient: client,
      env: process.env,
      model: process.env.OPENAI_MODEL,
    });

    if (!nutritionResult.shouldUseDefaultFlow && nutritionResult.answer) {
      return { reply: nutritionResult.answer };
    }
  }

  return generateReply(chatId, userText, {
    currentMessageId,
    currentMessageTimestampMs,
    memoryContextOverride: memoryContext,
  });
}

// =====================
// WhatsApp Bot
// =====================
let sock = null;
let isStarting = false;
let reconnectTimer = null;
let consecutive440Errors = 0;  // Track consecutive code 440 errors for exponential backoff

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
      receiveMessagesInBatches: true,
      downloadHistory: false,
      // Returning undefined prevents Baileys from sending retry receipts for group messages
      // it can't find in local storage — this stops the retry loop that causes code 440 conflicts
      getMessage: async (key) => {
        // Only attempt to retrieve messages from direct (non-group) chats
        if (key.remoteJid?.endsWith("@g.us")) return undefined;
        return undefined;
      },
    });

    console.log("📝 Setting up event listeners...");

    // Suppress non-fatal decryption errors from group messages to prevent connection drops
    sock.ev.on("error", (error) => {
      const msg = error?.message || String(error);
      // Ignore known group message decryption errors
      if (
        msg.includes("MessageCounterError") ||
        msg.includes("Received message with old counter") ||
        msg.includes("No session found") ||
        msg.includes("invalid wire type")
      ) {
        // Silent skip - these are harmless group message decryption failures
        return;
      }
      console.log("⚠️ Socket error:", msg);
    });

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
        consecutive440Errors = 0;  // Reset error counter on success
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
          consecutive440Errors++;
          const backoffMs = Math.min(10000, 3000 * Math.pow(1.5, consecutive440Errors - 1));
          console.log(`⚠️ Connection conflict (440) - attempt ${consecutive440Errors}`);
          console.log(`🔄 Reconnecting in ${Math.round(backoffMs / 1000)}s (exponential backoff)...`);
          isStarting = false;
          if (!reconnectTimer) {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              startBot();
            }, backoffMs);
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

      if (hasProcessedMessage(msg)) {
        console.log("⏭️  Skip: Duplicate upsert for message id=%s", msg?.key?.id || "[missing]");
        return;
      }

      if (shouldSkipAsStaleMessage(msg, type)) {
        console.log("⏭️  Skip: Stale/replayed message id=%s", msg?.key?.id || "[missing]");
        return;
      }

      const from = msg.key.remoteJid;

      const resolvedPhone = await resolvePhoneFromMessageKey(msg, sock);

      if (!resolvedPhone) {
        console.log("SKIP: real phone was not resolved");
        return;
      }

      if (!ALLOWED_NUMBERS.has(resolvedPhone)) {
        console.log(`SKIP: phone not allowed (${resolvedPhone})`);
        return;
      }

      if (resolvedPhone === BOT_NUMBER) {
        console.log("⏭️  Skip: Bot's own message");
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
          const buffer = await downloadMediaMessage(
            msg,
            "buffer",
            {},
            { reuploadRequest: sock.updateMediaMessage }
          );

          let barcodeDecodeResult = { found: false, barcode: null, format: null, errorCode: null };
          try {
            barcodeDecodeResult = await decodeBarcodeFromImage(buffer);
          } catch (decodeError) {
            console.log("BARCODE IMAGE DECODE FAILED", {
              error: decodeError?.code || "decode_error",
            });
          }

          const pendingStepBeforeImage = pending.get(from)?.step || null;
          const shouldClassifyImage =
            !barcodeDecodeResult.found &&
            !isBarcodeModeActive({ pendingStep: pendingStepBeforeImage, captionText: text });

          let packagedProductClassification = null;
          if (shouldClassifyImage) {
            try {
              const classifyResult = await classifyPackagedProductImage(buffer);
              packagedProductClassification = classifyResult.classification;
            } catch (classifyError) {
              console.log("PACKAGED PRODUCT CLASSIFICATION FAILED", {
                error: classifyError?.code || "classification_error",
              });
            }
          }

          // Only need the separate food/non-food judgment when the image
          // isn't already a recognized packaged product (that's already
          // food-related by definition, and barcode detection above always
          // takes priority regardless).
          let isFoodImage = null;
          let foodConfidence = null;
          if (shouldClassifyImage && packagedProductClassification !== "PACKAGED_PRODUCT") {
            try {
              const foodClassifyResult = await classifyFoodImage(buffer);
              isFoodImage = foodClassifyResult.isFoodImage;
              foodConfidence = foodClassifyResult.foodConfidence;
            } catch (foodClassifyError) {
              console.log("FOOD IMAGE CLASSIFICATION FAILED", {
                error: foodClassifyError?.code || "classification_error",
              });
            }
          }

          const imageBarcodeRoute = resolveImageBarcodeRouting({
            barcodeFound: barcodeDecodeResult.found,
            pendingStep: pendingStepBeforeImage,
            captionText: text,
            packagedProductClassification,
            isFoodImage,
            foodConfidence,
            foodConfidenceThreshold: FOOD_IMAGE_MIN_CONFIDENCE,
          });

          if (imageBarcodeRoute === IMAGE_BARCODE_ROUTES.PRODUCT_FLOW) {
            addToHistory(resolvedPhone, "user", text ? `[תמונה עם ברקוד] ${text}` : "[תמונה עם ברקוד]");
            await lookupAndRespondWithProduct({ sock, from, barcode: barcodeDecodeResult.barcode });
            return;
          }

          if (imageBarcodeRoute === IMAGE_BARCODE_ROUTES.BARCODE_GUIDANCE) {
            pending.set(from, { step: "awaiting_product_barcode", createdAt: Date.now() });
            addToHistory(resolvedPhone, "user", text ? `[תמונת ברקוד] ${text}` : "[תמונת ברקוד]");
            await sock.sendMessage(from, { text: BARCODE_READ_FAILED_HEBREW });
            return;
          }

          if (imageBarcodeRoute === IMAGE_BARCODE_ROUTES.REQUEST_BARCODE) {
            pending.set(from, { step: "awaiting_product_barcode", createdAt: Date.now() });
            addToHistory(resolvedPhone, "user", text ? `[תמונת מוצר ארוז] ${text}` : "[תמונת מוצר ארוז]");
            await sock.sendMessage(from, { text: PACKAGED_PRODUCT_DETECTED_HEBREW });
            return;
          }

          if (imageBarcodeRoute === IMAGE_BARCODE_ROUTES.NON_FOOD) {
            // No meal is estimated, no pending meal state is created, and
            // Open Food Facts is never called for a non-food image.
            addToHistory(resolvedPhone, "user", text ? `[תמונה שאינה מזון] ${text}` : "[תמונה שאינה מזון]");
            await sock.sendMessage(from, { text: NON_FOOD_IMAGE_HEBREW });
            return;
          }

          if (imageBarcodeRoute === IMAGE_BARCODE_ROUTES.LOW_CONFIDENCE_FOOD) {
            addToHistory(resolvedPhone, "user", text ? `[תמונה לא ברורה] ${text}` : "[תמונה לא ברורה]");
            await sock.sendMessage(from, { text: LOW_CONFIDENCE_FOOD_IMAGE_HEBREW });
            return;
          }

          console.log("MEAL ANALYSIS STARTED", {
            ingredientCount: 0,
            confidence: null,
          });

          await sock.sendMessage(from, {
            text: "מנתחת את התמונה עכשיו, רגע 🙏",
          });

          const mime = imageMessage.mimetype || "image/jpeg";
          const base64 = buffer.toString("base64");
          const dataUrl = `data:${mime};base64,${base64}`;

          addToHistory(resolvedPhone, "user", text ? `[תמונה] ${text}` : "[תמונה]");

          const analysis = await analyzeMealDataUrl(dataUrl, text);
          const shouldClarify = mealAnalysisNeedsClarification(analysis);
          const clarificationQuestion = shouldClarify
            ? getClarificationQuestionFromAnalysis(analysis)
            : null;
          const analysisText = formatMealAnalysisForUser(analysis);

          let uploadedImageUrl = null;

          try {
            uploadedImageUrl = await uploadMealImage(buffer, mime, resolvedPhone);
            console.log("✅ image uploaded:", uploadedImageUrl);
          } catch (uploadErr) {
            console.log(
              "❌ failed uploading image:",
              uploadErr?.message || uploadErr
            );
          }

          pending.set(from, {
            step: shouldClarify ? "awaiting_clarification" : "awaiting_meal_type",
            imageUrl: uploadedImageUrl,
            analysis,
            analysisText,
            mealNote: text || "",
            createdAt: Date.now(),
          });

          if (shouldClarify && clarificationQuestion) {
            await sock.sendMessage(from, {
              text: `${analysisText}

כדי לדייק יותר:
${clarificationQuestion}`,
            });
          } else {
            await sock.sendMessage(from, {
              text: `${analysisText}

איזו ארוחה זו הייתה?
כתבי רק אחת מהאפשרויות:
בוקר
צהריים
ערב
ביניים`,
            });
          }

          addToHistory(resolvedPhone, "assistant", analysisText);
          return;
        }

        if (text.trim()) {
          const cleanText = text.trim();
          const p = pending.get(from);

          if (p?.step === "awaiting_product_barcode") {
            await handleProductBarcodeInput({ sock, from, cleanText });
            return;
          }

          if (p?.step === "awaiting_product_amount") {
            await handleProductAmountInput({ sock, from, cleanText, pendingEntry: p });
            return;
          }

          if (p?.step === "awaiting_product_confirmation") {
            await handleProductConfirmationInput({ sock, from, cleanText, pendingEntry: p });
            return;
          }

          if (p?.step === "awaiting_product_meal_type") {
            await handleProductMealTypeInput({ sock, from, resolvedPhone, cleanText, pendingEntry: p });
            return;
          }

          if (p?.step === "awaiting_nutrition_target_info") {
            await handleNutritionTargetInfoInput({
              sock,
              from,
              resolvedPhone,
              cleanText,
              pendingEntry: p,
              messageId: msg?.key?.id || "",
            });
            return;
          }

          if (!p && shouldStartProductLookup(cleanText)) {
            await startProductLookupFlow({ sock, from, cleanText });
            return;
          }

          if (p?.step === "awaiting_clarification") {
            const refinedAnalysis = await repairMealAnalysisFromClarification(
              p.analysis,
              cleanText
            );
            const refinedAnalysisText = formatMealAnalysisForUser(refinedAnalysis);

            pending.set(from, {
              ...p,
              step: "awaiting_meal_type",
              analysis: refinedAnalysis,
              analysisText: refinedAnalysisText,
              mealNote: p.mealNote,
            });

            await sock.sendMessage(from, {
              text: `${refinedAnalysisText}

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

            console.log("WhatsApp destination:", from);
            console.log("Resolved real phone:", resolvedPhone);
            console.log("Saving meal for phone:", resolvedPhone);

            const saved = await saveMealEntry({
              phone: resolvedPhone,
              mealNote: p.mealNote,
              analysis: p.analysis,
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

          if (!p && detectNutritionTargetRequest(cleanText).isNutritionTargetRequest) {
            await startNutritionTargetFlow({
              sock,
              from,
              resolvedPhone,
              cleanText,
              messageId: msg?.key?.id || "",
            });
            return;
          }

          if (!p) {
            const handledAsStandaloneProfileUpdate = await handleStandaloneProfileUpdate({
              sock,
              from,
              resolvedPhone,
              cleanText,
              messageId: msg?.key?.id || "",
            });
            if (handledAsStandaloneProfileUpdate) return;
          }

          addToHistory(resolvedPhone, "user", cleanText);

          const memoryService = await getMemoryService();

          // Save user message to Firestore
          if (memoryService) {
            try {
              await memoryService.saveMessage(resolvedPhone, "user", cleanText, {
                sourceType: type,
                messageId: msg?.key?.id || "",
                isSummaryEligible: type === "notify" && Boolean(cleanText),
              });
              console.log("💾 Firestore: Saved user message");
            } catch (error) {
              console.log("⚠️  Firestore error (save user): %s", error?.message || error);
            }
          }

          const replyData = await generateReplyWithNutritionKnowledge(resolvedPhone, cleanText, {
            currentMessageId: msg?.key?.id || "",
            currentMessageTimestampMs: toTimestampMs(msg?.messageTimestamp),
          });
          const reply = replyData?.reply || replyData;

          await sock.sendMessage(from, { text: reply });

          addToHistory(resolvedPhone, "assistant", reply);

          // Save assistant message and update memory if needed
          if (memoryService) {
            try {
              await memoryService.saveMessage(resolvedPhone, "assistant", reply, {
                sourceType: type,
                messageId: msg?.key?.id || "",
                isSummaryEligible: type === "notify" && Boolean(reply?.trim?.() || ""),
              });
              console.log("💾 Firestore: Saved assistant message");
            } catch (error) {
              console.log("⚠️  Firestore error (save assistant): %s", error?.message || error);
            }
          }

          if (memoryService) {
            void maybeUpdateLongTermMemory({
              phone: resolvedPhone,
              sourceType: type,
              messageId: msg?.key?.id || "",
              userMessage: cleanText,
            }).catch((error) => {
              console.log("MEMORY UPDATE FAILED", {
                phone: resolvedPhone,
                messageId: msg?.key?.id || null,
                error: error?.message || error,
              });
            });
          }

          if (memoryService) {
            void maybeCreateConversationSummary(resolvedPhone).catch((error) => {
              console.log("SUMMARY FAILED", {
                phone: resolvedPhone,
                newEligibleMessages: 0,
                error: error?.message || error,
              });
            });
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

if (isMainModule) {
  startBot();
}

// Exported ONLY for integration testing (see integration/*.test.js), which
// imports this module with `./firebase-admin.js` and
// `./services/memory.service.js` mocked via mock.module(), a fake `sock`
// object (just needs sendMessage(to, {text})), and isMainModule guarding
// app.listen()/startBot() so importing this file never binds a port or
// starts a real WhatsApp connection.
export {
  pending,
  startNutritionTargetFlow,
  handleNutritionTargetInfoInput,
  handleStandaloneProfileUpdate,
  getStoredNutritionProfileLayers,
  saveTargetProfileFields,
};