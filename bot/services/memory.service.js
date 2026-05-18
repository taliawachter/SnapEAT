import { db } from "../firebase-admin.js";

const CHAT_MESSAGES_COLLECTION = "chatMessages";
const USER_MEMORIES_COLLECTION = "userMemories";
const CONVERSATION_SUMMARIES_COLLECTION = "conversationSummaries";

const ALLOWED_ROLES = new Set(["user", "assistant", "system"]);
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

function assertProfileUpdates(value) {
  if (value === undefined || value === null) return;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("profileUpdates must be an object");
  }
}

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

export async function saveMessage(userId, role, content) {
  assertRequiredString(userId, "userId");
  assertRequiredString(role, "role");
  assertRole(role);
  assertRequiredString(content, "content");

  const normalizedUserId = userId.trim();
  const normalizedRole = role.trim();
  const normalizedContent = content.trim();

  try {
    const payload = {
      userId: normalizedUserId,
      role: normalizedRole,
      content: normalizedContent,
      createdAt: new Date(),
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

export async function getRecentMessages(userId, limit = 10) {
  assertRequiredString(userId, "userId");

  const normalizedUserId = userId.trim();
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(100, parsedLimit))
    : 10;

  try {
    const snapshot = await db
      .collection(CHAT_MESSAGES_COLLECTION)
      .where("userId", "==", normalizedUserId)
      .orderBy("createdAt", "desc")
      .limit(safeLimit)
      .get();

    const messages = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return messages.reverse();
  } catch (error) {
    console.error("Failed to fetch recent messages", {
      userId,
      limit: safeLimit,
      error: error.message,
    });
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

export async function upsertUserMemory(userId, profileUpdates) {
  assertRequiredString(userId, "userId");
  assertProfileUpdates(profileUpdates);

  const normalizedUserId = userId.trim();
  const updates = profileUpdates || {};
  const docRef = db.collection(USER_MEMORIES_COLLECTION).doc(normalizedUserId);

  try {
    const existingSnap = await docRef.get();
    const existingData = existingSnap.exists ? existingSnap.data() : {};
    const mergedProfile = {
      ...(existingData?.profile || {}),
      ...updates,
    };

    const payload = {
      userId: normalizedUserId,
      profile: mergedProfile,
      updatedAt: new Date(),
    };

    await docRef.set(payload, { merge: true });

    return {
      id: normalizedUserId,
      ...payload,
    };
  } catch (error) {
    console.error("Failed to upsert user memory", { userId, error: error.message });
    throw error;
  }
}

export async function getLatestSummary(userId) {
  assertRequiredString(userId, "userId");

  const normalizedUserId = userId.trim();

  try {
    const snapshot = await db
      .collection(CONVERSATION_SUMMARIES_COLLECTION)
      .where("userId", "==", normalizedUserId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

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

export async function saveConversationSummary(userId, summary) {
  assertRequiredString(userId, "userId");
  assertRequiredString(summary, "summary");

  const normalizedUserId = userId.trim();
  const normalizedSummary = summary.trim();

  try {
    const payload = {
      userId: normalizedUserId,
      summary: normalizedSummary,
      createdAt: new Date(),
    };

    const docRef = await db.collection(CONVERSATION_SUMMARIES_COLLECTION).add(payload);

    return {
      id: docRef.id,
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

export { sanitizeMemoryUpdate };
