import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

// Regression coverage for a bug where the deterministic scope guard
// (isNutritionRelatedMessage) accepted a message, but the *assistant* path
// (generateReplyWithNutritionKnowledge -> generateReply) still produced the
// scope guard's own out-of-scope sentence. Root cause: generateReply()'s
// OpenAI system prompt used to hard-code the exact out-of-scope sentence as
// an instruction the model could self-trigger, duplicating (and
// occasionally contradicting) the upstream deterministic guard. See
// index.js generateReply() for the corrected prompt.
//
// index.js imports `{ db, bucket }` from ../firebase-admin.js and the
// `openai` package at module load time, so both are mocked before import,
// matching the pattern used by tests/memory.service.test.js and
// integration/api.test.js.

function chainableQuery(snapshot) {
  const query = {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    get: async () => snapshot,
  };
  return query;
}

function makeFakeDb() {
  const docSnap = { exists: false, data: () => undefined };
  const querySnapshot = { empty: true, docs: [] };
  const docRef = {
    id: "doc-id",
    get: async () => docSnap,
    create: async (payload) => payload,
  };

  return {
    collection: () => ({
      add: async (payload) => ({ id: "generated-id", ...payload }),
      doc: () => docRef,
      where: () => chainableQuery(querySnapshot),
      orderBy: () => chainableQuery(querySnapshot),
    }),
    runTransaction: async (fn) => fn({ get: async () => docSnap, set: () => {} }),
  };
}

mock.module("../firebase-admin.js", {
  namedExports: {
    db: makeFakeDb(),
    bucket: {},
  },
});

// Swappable per-test so each test controls what the "model" returns,
// without re-registering the module mock (mock.module only applies once
// per specifier per process).
let currentChatCompletionsCreate = async () => {
  throw new Error("chat.completions.create not configured for this test");
};
let currentResponsesCreate = async () => {
  throw new Error("responses.create not configured for this test");
};

class FakeOpenAI {
  constructor() {
    this.chat = {
      completions: {
        create: (...args) => currentChatCompletionsCreate(...args),
      },
    };
    this.responses = {
      create: (...args) => currentResponsesCreate(...args),
    };
  }
}

mock.module("openai", { defaultExport: FakeOpenAI });

const { generateReply, generateReplyWithNutritionKnowledge } = await import("../index.js");
const { isNutritionRelatedMessage, getOutOfScopeReply } = await import(
  "../services/scope-guard.service.js"
);
const { getNutritionKnowledgeAnswer } = await import("../services/nutrition-knowledge.service.js");

const TARGET_MESSAGE = "מה אני צריכה לאכול בשביל לרדת במשקל";

function chatCompletionResult(replyText) {
  return {
    choices: [{ message: { content: JSON.stringify({ reply: replyText }) } }],
  };
}

function emptyFileSearchResponse() {
  // No output_text and no output items => getNutritionKnowledgeAnswer's
  // extractAnswerFromResponse() returns "", forcing the RAG path to fall
  // back and delegate to generateReply() (the exact path that reproduced
  // the bug).
  return { id: "resp_test", output_text: "", output: [] };
}

test("precondition: the scope guard accepts the target message", () => {
  assert.equal(isNutritionRelatedMessage(TARGET_MESSAGE, null), true);
});

test("generateReply's system prompt no longer instructs the model to self-reject scope", async () => {
  let capturedMessages = null;
  currentChatCompletionsCreate = async ({ messages }) => {
    capturedMessages = messages;
    return chatCompletionResult("תשובה תזונתית רגילה.");
  };

  const result = await generateReply("test-chat-id", TARGET_MESSAGE, {
    memoryContextOverride: { longTermMemory: null, latestSummary: "", recentMessages: [] },
  });

  const systemMessage = capturedMessages.find((m) => m.role === "system");
  assert.ok(systemMessage, "expected a system message to be sent to OpenAI");
  assert.ok(
    !systemMessage.content.includes(getOutOfScopeReply()),
    "system prompt must not hard-code the out-of-scope sentence"
  );
  assert.ok(
    !systemMessage.content.includes("נושא לא רלוונטי"),
    "system prompt must not ask the model to self-judge topic relevance"
  );
  assert.ok(
    !systemMessage.content.includes("אל תעני על נושאים לא קשורים"),
    "system prompt must not duplicate the scope guard's topic blocklist"
  );
  assert.equal(result.reply, "תשובה תזונתית רגילה.");
});

test("an accepted nutrition question cannot produce the out-of-scope reply through the assistant path", async () => {
  assert.equal(isNutritionRelatedMessage(TARGET_MESSAGE, null), true);

  currentResponsesCreate = async () => emptyFileSearchResponse();
  currentChatCompletionsCreate = async () =>
    chatCompletionResult("כדאי להתמקד בארוחות מאוזנות עם חלבון, ירקות וסיבים.");

  const replyData = await generateReplyWithNutritionKnowledge("test-chat-id-2", TARGET_MESSAGE, {});
  const reply = replyData?.reply || replyData;

  assert.notEqual(reply, getOutOfScopeReply());
  assert.equal(reply, "כדאי להתמקד בארוחות מאוזנות עם חלבון, ירקות וסיבים.");
});

test("getNutritionKnowledgeAnswer's own fallback strings are distinct from the out-of-scope sentence", async () => {
  const result = await getNutritionKnowledgeAnswer({
    question: TARGET_MESSAGE,
    openaiClient: null,
    env: {},
    model: "",
  });

  assert.notEqual(result.answer, getOutOfScopeReply());
});
