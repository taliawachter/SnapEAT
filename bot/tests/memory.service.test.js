import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

// memory.service.js talks to Firestore through ../firebase-admin.js.
// We mock that module (never a real Firebase project) so these tests
// exercise memory.service.js's own validation, shaping, and error-handling
// logic in isolation.

function chainableQuery(snapshot) {
  const query = {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    get: async () => snapshot,
  };
  return query;
}

function makeFakeDb({
  addResult = { id: "generated-id" },
  addError = null,
  docSnap = { exists: false, data: () => undefined },
  docGetError = null,
  querySnapshot = { empty: true, docs: [] },
  transactionResult,
  transactionError = null,
  createResult = undefined,
  createError = null,
} = {}) {
  const docRef = {
    id: "doc-id",
    get: async () => {
      if (docGetError) throw docGetError;
      return docSnap;
    },
    create: async (payload) => {
      if (createError) throw createError;
      return createResult ?? payload;
    },
  };

  return {
    collection: () => ({
      add: async (payload) => {
        if (addError) throw addError;
        return { id: addResult.id, ...payload };
      },
      doc: () => docRef,
      where: () => chainableQuery(querySnapshot),
      orderBy: () => chainableQuery(querySnapshot),
    }),
    runTransaction: async (fn) => {
      if (transactionError) throw transactionError;
      if (transactionResult) return transactionResult;
      const tx = {
        get: async () => docSnap,
        set: () => {},
      };
      return fn(tx);
    },
  };
}

// mock.module can only target a given specifier once per process, and ESM
// modules are cached on first import, so we mock ../firebase-admin.js a
// single time behind a proxy whose target is swapped per test.
let currentDb = makeFakeDb();
mock.module("../firebase-admin.js", {
  namedExports: {
    db: new Proxy(
      {},
      {
        get(_target, prop) {
          return currentDb[prop];
        },
      }
    ),
    bucket: {},
  },
});

const memoryServicePromise = import("../services/memory.service.js");

async function loadMemoryServiceWithDb(fakeDb) {
  currentDb = fakeDb;
  return memoryServicePromise;
}

test("saveMessage rejects a missing userId before touching Firestore", async () => {
  const memoryService = await loadMemoryServiceWithDb(makeFakeDb());
  await assert.rejects(() => memoryService.saveMessage("", "user", "hello"), /userId is required/);
});

test("saveMessage rejects an invalid role", async () => {
  const memoryService = await loadMemoryServiceWithDb(makeFakeDb());
  await assert.rejects(
    () => memoryService.saveMessage("user-1", "narrator", "hello"),
    /role must be one of/
  );
});

test("saveMessage marks a notify-sourced user message as summary-eligible", async () => {
  const memoryService = await loadMemoryServiceWithDb(makeFakeDb());
  const saved = await memoryService.saveMessage("user-1", "user", "hi there", {
    sourceType: "notify",
  });
  assert.equal(saved.isSummaryEligible, true);
  assert.equal(saved.userId, "user-1");
  assert.equal(saved.id, "generated-id");
});

test("saveMessage marks a system message as not summary-eligible by default", async () => {
  const memoryService = await loadMemoryServiceWithDb(makeFakeDb());
  const saved = await memoryService.saveMessage("user-1", "system", "internal note");
  assert.equal(saved.isSummaryEligible, false);
});

test("saveMessage surfaces the underlying Firestore error without swallowing it", async () => {
  const memoryService = await loadMemoryServiceWithDb(
    makeFakeDb({ addError: new Error("firestore unavailable") })
  );
  await assert.rejects(
    () => memoryService.saveMessage("user-1", "user", "hi"),
    /firestore unavailable/
  );
});

test("getUserMemory returns null for a user with no memory document", async () => {
  const memoryService = await loadMemoryServiceWithDb(
    makeFakeDb({ docSnap: { exists: false, data: () => undefined } })
  );
  const result = await memoryService.getUserMemory("user-1");
  assert.equal(result, null);
});

test("getUserMemory returns the stored profile when a document exists", async () => {
  const memoryService = await loadMemoryServiceWithDb(
    makeFakeDb({
      docSnap: { exists: true, id: "user-1", data: () => ({ profile: { goals: ["lose weight"] } }) },
    })
  );
  const result = await memoryService.getUserMemory("user-1");
  assert.deepEqual(result.profile, { goals: ["lose weight"] });
});

test("getUserMemory propagates Firestore read failures instead of hiding them", async () => {
  const memoryService = await loadMemoryServiceWithDb(
    makeFakeDb({ docGetError: new Error("permission denied") })
  );
  await assert.rejects(() => memoryService.getUserMemory("user-1"), /permission denied/);
});

test("applyIntelligentMemoryUpdate rejects a non-object updatedProfile", async () => {
  const memoryService = await loadMemoryServiceWithDb(makeFakeDb());
  await assert.rejects(
    () => memoryService.applyIntelligentMemoryUpdate("user-1", { updatedProfile: "not-an-object" }),
    /updatedProfile must be an object/
  );
});

test("applyIntelligentMemoryUpdate reports duplicate=true when the messageId was already processed", async () => {
  const memoryService = await loadMemoryServiceWithDb(
    makeFakeDb({
      docSnap: { exists: true, data: () => ({ processedMessageIds: ["msg-1"] }) },
    })
  );
  const result = await memoryService.applyIntelligentMemoryUpdate("user-1", {
    updatedProfile: { goals: [] },
    messageId: "msg-1",
  });
  assert.deepEqual(result, { duplicate: true, updated: false });
});

test("applyIntelligentMemoryUpdate reports updated=true for a new messageId", async () => {
  const memoryService = await loadMemoryServiceWithDb(
    makeFakeDb({
      docSnap: { exists: true, data: () => ({ processedMessageIds: ["msg-1"] }) },
    })
  );
  const result = await memoryService.applyIntelligentMemoryUpdate("user-1", {
    updatedProfile: { goals: ["eat more protein"] },
    messageId: "msg-2",
  });
  assert.deepEqual(result, { duplicate: false, updated: true });
});

test("applyIntelligentMemoryUpdate propagates a transaction failure", async () => {
  const memoryService = await loadMemoryServiceWithDb(
    makeFakeDb({ transactionError: new Error("transaction aborted") })
  );
  await assert.rejects(
    () =>
      memoryService.applyIntelligentMemoryUpdate("user-1", {
        updatedProfile: { goals: [] },
      }),
    /transaction aborted/
  );
});

test("getLatestSummary returns null when no summary document exists", async () => {
  const memoryService = await loadMemoryServiceWithDb(
    makeFakeDb({ querySnapshot: { empty: true, docs: [] } })
  );
  const result = await memoryService.getLatestSummary("user-1");
  assert.equal(result, null);
});

test("getLatestSummary returns the summary document when found", async () => {
  const memoryService = await loadMemoryServiceWithDb(
    makeFakeDb({
      querySnapshot: {
        empty: false,
        docs: [{ id: "summary-1", data: () => ({ summary: "user likes salads" }) }],
      },
    })
  );
  const result = await memoryService.getLatestSummary("user-1");
  assert.equal(result.id, "summary-1");
  assert.equal(result.summary, "user likes salads");
});

test("getUnsummarizedMessages filters out empty-content and system-role documents defensively", async () => {
  const memoryService = await loadMemoryServiceWithDb(
    makeFakeDb({
      querySnapshot: {
        empty: false,
        docs: [
          { id: "1", data: () => ({ role: "user", content: "hi" }) },
          { id: "2", data: () => ({ role: "system", content: "internal" }) },
          { id: "3", data: () => ({ role: "assistant", content: "" }) },
          { id: "4", data: () => ({ role: "assistant", content: "hello back" }) },
        ],
      },
    })
  );
  const result = await memoryService.getUnsummarizedMessages("user-1");
  assert.deepEqual(
    result.map((m) => m.id),
    ["1", "4"]
  );
});

test("getRecentEligibleMessages clamps limit into the documented [2, 20] range", async () => {
  const memoryService = await loadMemoryServiceWithDb(
    makeFakeDb({ querySnapshot: { empty: true, docs: [] } })
  );
  // Should not throw for an out-of-range limit; internal clamping applies.
  const result = await memoryService.getRecentEligibleMessages("user-1", { limit: 999 });
  assert.deepEqual(result, []);
});

test("saveConversationSummary requires non-empty summary text", async () => {
  const memoryService = await loadMemoryServiceWithDb(makeFakeDb());
  await assert.rejects(
    () => memoryService.saveConversationSummary("user-1", { summary: "" }),
    /summary is required/
  );
});

test("saveConversationSummary accepts the legacy plain-string summary form", async () => {
  const memoryService = await loadMemoryServiceWithDb(makeFakeDb());
  const result = await memoryService.saveConversationSummary("user-1", "user prefers vegetarian meals");
  assert.equal(result.summary, "user prefers vegetarian meals");
  assert.equal(result.phone, "user-1");
});

test("saveConversationSummary surfaces a write failure instead of silently succeeding", async () => {
  const memoryService = await loadMemoryServiceWithDb(
    makeFakeDb({ createError: new Error("doc already exists") })
  );
  await assert.rejects(
    () => memoryService.saveConversationSummary("user-1", "some summary"),
    /doc already exists/
  );
});
