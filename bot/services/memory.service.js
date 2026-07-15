import { db } from "../firebase-admin.js";
import { FieldValue } from "firebase-admin/firestore";

const CHAT_MESSAGES_COLLECTION = "chatMessages";
const USER_MEMORIES_COLLECTION = "userMemories";
const CONVERSATION_SUMMARIES_COLLECTION = "conversationSummaries";

const ALLOWED_ROLES = new Set(["user", "assistant", "system"]);

function assertRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
}

function assertRole(role) {
  if (!ALLOWED_ROLES.has(String(role || "").trim())) {
    throw new Error("role must be one of: user, assistant, system");
  }
}

function toDateOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toMillis(value) {
  const asDate = toDateOrNull(value);
  return asDate ? asDate.getTime() : null;
}

function sanitizeDocIdPart(value = "") {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);
}

export async function saveMessage(userId, role, content, options = {}) {
  assertRequiredString(userId, "userId");
  assertRequiredString(role, "role");
  assertRole(role);
  assertRequiredString(content, "content");

  const normalizedUserId = userId.trim();
  const normalizedRole = role.trim();
  const normalizedContent = content.trim();
  const sourceType = String(options?.sourceType || "").trim();
  const messageId = String(options?.messageId || "").trim();
  const explicitSummaryEligibility = options?.isSummaryEligible;

  const isSummaryEligible = typeof explicitSummaryEligibility === "boolean"
    ? explicitSummaryEligibility
    : normalizedRole !== "system" && normalizedContent.length > 0 && sourceType === "notify";

  try {
    const payload = {
      userId: normalizedUserId,
      role: normalizedRole,
      content: normalizedContent,
      createdAt: new Date(),
      sourceType: sourceType || null,
      messageId: messageId || null,
      isSummaryEligible,
    };

    const docRef = await db.collection(CHAT_MESSAGES_COLLECTION).add(payload);

    return {
      id: docRef.id,
      ...payload,
    };
  } catch (error) {
    console.error("Failed to save chat message", { userId, error: error.message });
    throw error;
  }
}

export async function getUserMemory(userId) {
  assertRequiredString(userId, "userId");

  const normalizedUserId = userId.trim();

  try {
    const docRef = db.collection(USER_MEMORIES_COLLECTION).doc(normalizedUserId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) return null;

    return {
      id: docSnap.id,
      ...docSnap.data(),
    };
  } catch (error) {
    console.error("Failed to fetch user memory", { userId, error: error.message });
    throw error;
  }
}

export async function applyIntelligentMemoryUpdate(
  userId,
  {
    updatedProfile,
    messageId = "",
    lastUpdatedCategories = [],
    lastUpdateSource = "user_message",
    memoryVersion = 2,
  } = {}
) {
  assertRequiredString(userId, "userId");

  if (!updatedProfile || typeof updatedProfile !== "object" || Array.isArray(updatedProfile)) {
    throw new Error("updatedProfile must be an object");
  }

  const normalizedUserId = userId.trim();
  const normalizedMessageId = String(messageId || "").trim();
  const normalizedCategories = Array.isArray(lastUpdatedCategories)
    ? Array.from(new Set(lastUpdatedCategories.map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 30)
    : [];

  const docRef = db.collection(USER_MEMORIES_COLLECTION).doc(normalizedUserId);

  try {
    const txResult = await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(docRef);
      const existingData = existingSnap.exists ? existingSnap.data() : {};
      const processedIds = Array.isArray(existingData?.processedMessageIds)
        ? existingData.processedMessageIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];

      if (normalizedMessageId && processedIds.includes(normalizedMessageId)) {
        return {
          duplicate: true,
          updated: false,
        };
      }

      const nextProcessedIds = normalizedMessageId
        ? [...processedIds.slice(-199), normalizedMessageId]
        : processedIds.slice(-200);

      const payload = {
        userId: normalizedUserId,
        profile: updatedProfile,
        updatedAt: FieldValue.serverTimestamp(),
        memoryVersion: Number.isFinite(Number(memoryVersion)) ? Number(memoryVersion) : 2,
        lastUpdateSource: String(lastUpdateSource || "user_message"),
        lastUpdatedCategories: normalizedCategories,
      };

      if (!existingData?.createdAt) {
        payload.createdAt = FieldValue.serverTimestamp();
      }

      if (normalizedMessageId) {
        payload.lastProcessedMessageId = normalizedMessageId;
        payload.processedMessageIds = nextProcessedIds;
      }

      tx.set(docRef, payload, { merge: true });

      return {
        duplicate: false,
        updated: true,
      };
    });

    return txResult;
  } catch (error) {
    console.error("Failed to apply intelligent memory update", {
      userId,
      messageId: normalizedMessageId,
      error: error.message,
    });
    throw error;
  }
}

export async function getLatestSummary(userId) {
  assertRequiredString(userId, "userId");

  const normalizedUserId = userId.trim();

  try {
    let snapshot = await db
      .collection(CONVERSATION_SUMMARIES_COLLECTION)
      .where("userId", "==", normalizedUserId)
      .orderBy("summarizedUntil", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) {
      snapshot = await db
        .collection(CONVERSATION_SUMMARIES_COLLECTION)
        .where("userId", "==", normalizedUserId)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
    }

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];

    return {
      id: doc.id,
      ...doc.data(),
    };
  } catch (error) {
    console.error("Failed to fetch latest conversation summary", {
      userId,
      error: error.message,
    });
    throw error;
  }
}

export async function getUnsummarizedMessages(
  userId,
  { afterTimestamp = null, limit = 120, lookbackDays = 90 } = {}
) {
  assertRequiredString(userId, "userId");

  const normalizedUserId = userId.trim();
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(500, parsedLimit))
    : 120;

  const parsedLookbackDays = Number(lookbackDays);
  const safeLookbackDays = Number.isFinite(parsedLookbackDays)
    ? Math.max(30, Math.min(90, parsedLookbackDays))
    : 90;

  const afterDate = toDateOrNull(afterTimestamp);
  const lookbackStart = new Date(Date.now() - safeLookbackDays * 24 * 60 * 60 * 1000);

  try {
    let query = db
      .collection(CHAT_MESSAGES_COLLECTION)
      .where("userId", "==", normalizedUserId)
      .where("isSummaryEligible", "==", true)
      .where("role", "in", ["user", "assistant"])
      .orderBy("createdAt", "asc");

    if (afterDate) {
      query = query.where("createdAt", ">", afterDate);
    } else {
      query = query.where("createdAt", ">=", lookbackStart);
    }

    const snapshot = await query.limit(safeLimit).get();

    return snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      .filter((item) => {
        const role = String(item?.role || "").trim();
        const content = String(item?.content || "").trim();
        return (role === "user" || role === "assistant") && Boolean(content);
      });
  } catch (error) {
    console.error("Failed to fetch unsummarized messages", {
      userId,
      error: error.message,
    });
    throw error;
  }
}

export async function getRecentEligibleMessages(
  userId,
  { limit = 8, afterTimestamp = null } = {}
) {
  assertRequiredString(userId, "userId");

  const normalizedUserId = userId.trim();
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.max(2, Math.min(20, Math.floor(parsedLimit)))
    : 8;
  const afterDate = toDateOrNull(afterTimestamp);

  try {
    let query = db
      .collection(CHAT_MESSAGES_COLLECTION)
      .where("userId", "==", normalizedUserId)
      .where("isSummaryEligible", "==", true)
      .where("role", "in", ["user", "assistant"])
      .orderBy("createdAt", "desc");

    if (afterDate) {
      query = query.where("createdAt", ">", afterDate);
    }

    const snapshot = await query.limit(safeLimit).get();

    return snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      .filter((item) => {
        const role = String(item?.role || "").trim();
        const content = String(item?.content || "").trim();
        return (role === "user" || role === "assistant") && Boolean(content);
      })
      .reverse();
  } catch (error) {
    console.error("Failed to fetch recent eligible messages", {
      userId,
      limit: safeLimit,
      error: error.message,
    });
    throw error;
  }
}

export async function saveConversationSummary(userId, summary) {
  assertRequiredString(userId, "userId");

  const normalizedUserId = userId.trim();
  const isLegacySummaryString = typeof summary === "string";
  const summaryText = isLegacySummaryString ? summary : summary?.summary;
  assertRequiredString(summaryText, "summary");

  const normalizedSummary = String(summaryText).trim();
  const summaryData = isLegacySummaryString ? {} : summary;
  const phone = String(summaryData?.phone || normalizedUserId).trim();
  assertRequiredString(phone, "phone");

  const parsedCount = Number(summaryData?.messageCount ?? 0);
  const messageCount = Number.isFinite(parsedCount) ? Math.max(0, Math.floor(parsedCount)) : 0;

  const previousSummaryId = summaryData?.previousSummaryId
    ? String(summaryData.previousSummaryId).trim()
    : null;

  const summarizedFrom = toDateOrNull(summaryData?.summarizedFrom);
  const summarizedUntil = toDateOrNull(summaryData?.summarizedUntil) || new Date();
  const model = String(summaryData?.model || "gpt-4o-mini").trim();
  const parsedVersion = Number(summaryData?.version ?? 1);
  const version = Number.isFinite(parsedVersion) ? Math.max(1, Math.floor(parsedVersion)) : 1;
  const summarizedFromMessageId = summaryData?.summarizedFromMessageId
    ? String(summaryData.summarizedFromMessageId).trim()
    : null;
  const summarizedUntilMessageId = summaryData?.summarizedUntilMessageId
    ? String(summaryData.summarizedUntilMessageId).trim()
    : null;

  const untilMs = toMillis(summarizedUntil) || Date.now();
  const stableDocId = [
    "summary",
    sanitizeDocIdPart(normalizedUserId),
    String(untilMs),
    String(messageCount),
  ].join("_");

  try {
    const payload = {
      userId: normalizedUserId,
      phone,
      summary: normalizedSummary,
      messageCount,
      previousSummaryId,
      summarizedFrom,
      summarizedUntil,
      createdAt: FieldValue.serverTimestamp(),
      model,
      version,
      summarizedFromMessageId,
      summarizedUntilMessageId,
    };

    const docRef = db.collection(CONVERSATION_SUMMARIES_COLLECTION).doc(stableDocId);
    await docRef.create(payload);

    return {
      id: stableDocId,
      ...payload,
    };
  } catch (error) {
    console.error("Failed to save conversation summary", {
      userId,
      error: error.message,
    });
    throw error;
  }
}
