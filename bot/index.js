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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

app.listen(PORT, () => {
  console.log(`✅ Web running: http://localhost:${PORT}`);
});

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
async function generateReply(chatId, userText, { currentMessageId = "", currentMessageTimestampMs = null } = {}) {
  const memoryContext = await buildMemoryContext(chatId, {
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
          console.log("MEAL ANALYSIS STARTED", {
            ingredientCount: 0,
            confidence: null,
          });

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

      const replyData = await generateReply(resolvedPhone, cleanText, {
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

startBot();