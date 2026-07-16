import test from "node:test";
import assert from "node:assert/strict";

import { getNutritionKnowledgeAnswer } from "../services/nutrition-knowledge.service.js";

const SAFE_FALLBACK_HEBREW = "כרגע לא הצלחתי לגשת למקורות המידע המאומתים, ולכן אני לא רוצה לתת תשובה שעלולה להיות לא מדויקת. אפשר לנסות שוב מאוחר יותר, ובשאלה רפואית או אישית מומלץ לפנות לאיש מקצוע מוסמך.";
const VERIFIED_INFO_UNAVAILABLE_HEBREW = "אין לי כרגע מספיק מידע מאומת במאגר כדי לענות על החלק הזה במדויק.";
const EXTREME_WEIGHT_LOSS_SAFE_HEBREW = "ירידה קיצונית ומהירה במשקל עלולה להיות לא בטוחה. מומלץ להתמקד בשינויים הדרגתיים ולהתייעץ עם דיאטנית או רופא לצורך התאמה אישית.";

function buildEnv(overrides = {}) {
  return {
    OPENAI_API_KEY: "test-key",
    OPENAI_VECTOR_STORE_ID: "vs_test_123",
    OPENAI_MODEL: "gpt-4o-mini",
    OPENAI_FILE_SEARCH_MAX_RESULTS: "5",
    ...overrides,
  };
}

function buildMockClient(responseFactory) {
  const calls = [];

  return {
    calls,
    responses: {
      async create(payload) {
        calls.push(payload);
        if (typeof responseFactory === "function") {
          return responseFactory(payload);
        }
        return responseFactory;
      },
    },
  };
}

test("blank question returns default-flow signal", async () => {
  const client = buildMockClient({ id: "resp_unused", output_text: "ignored" });
  const result = await getNutritionKnowledgeAnswer({
    question: "   ",
    env: buildEnv(),
    openaiClient: client,
  });

  assert.equal(result.errorCode, "BLANK_QUESTION");
  assert.equal(result.shouldUseDefaultFlow, true);
  assert.equal(client.calls.length, 0);
});

test("missing OPENAI_VECTOR_STORE_ID returns safe verified-source-unavailable response", async () => {
  const client = buildMockClient({ id: "resp_unused", output_text: "ignored" });
  const result = await getNutritionKnowledgeAnswer({
    question: "מה הם מקורות טובים לחלבון?",
    env: buildEnv({ OPENAI_VECTOR_STORE_ID: "" }),
    openaiClient: client,
  });

  assert.equal(result.errorCode, "OPENAI_VECTOR_STORE_ID_MISSING");
  assert.equal(result.shouldUseDefaultFlow, false);
  assert.equal(result.usedFallback, true);
  assert.equal(result.answer, SAFE_FALLBACK_HEBREW);
  assert.equal(client.calls.length, 0);
});

test("missing OPENAI_MODEL returns safe verified-source-unavailable response", async () => {
  const client = buildMockClient({ id: "resp_unused", output_text: "ignored" });
  const result = await getNutritionKnowledgeAnswer({
    question: "למה חשוב לשתות מים?",
    env: buildEnv({ OPENAI_MODEL: "" }),
    openaiClient: client,
  });

  assert.equal(result.errorCode, "OPENAI_MODEL_MISSING");
  assert.equal(result.shouldUseDefaultFlow, false);
  assert.equal(result.usedFallback, true);
  assert.equal(result.answer, SAFE_FALLBACK_HEBREW);
  assert.equal(client.calls.length, 0);
});

test("successful response keeps citations internal and does not show sources footer", async () => {
  const client = buildMockClient({
    id: "resp_ok_1",
    output_text: "מקורות טובים לחלבון כוללים קטניות, ביצים ודגים.",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "מקורות טובים לחלבון כוללים קטניות, ביצים ודגים.",
            annotations: [
              {
                type: "file_citation",
                file_id: "file_abc",
                filename: "snap-eat-nutrition-knowledge.md",
                index: 0,
              },
            ],
          },
        ],
      },
    ],
  });

  const result = await getNutritionKnowledgeAnswer({
    question: "מה הם מקורות טובים לחלבון?",
    env: buildEnv(),
    openaiClient: client,
  });

  assert.equal(result.responseId, "resp_ok_1");
  assert.equal(result.usedFallback, false);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].fileId, "file_abc");
  assert.match(result.answer, /חלבון/);
  assert.equal(result.answer.includes("מקורות:"), false);
  assert.equal(result.answer.includes("snap-eat-nutrition-knowledge.md"), false);
});

test("empty OpenAI response returns safe fallback answer", async () => {
  const client = buildMockClient({ id: "resp_empty", output_text: "", output: [] });

  const result = await getNutritionKnowledgeAnswer({
    question: "איך לרדת במשקל בצורה הדרגתית?",
    env: buildEnv(),
    openaiClient: client,
  });

  assert.equal(result.errorCode, "EMPTY_OPENAI_RESPONSE");
  assert.equal(result.usedFallback, true);
  assert.equal(result.shouldUseDefaultFlow, false);
  assert.ok(result.answer.length > 0);
});

test("OpenAI API failure returns safe fallback without leaking secrets", async () => {
  const client = buildMockClient(() => {
    const err = new Error("request failed for key sk-secret-value");
    err.code = "bad_request";
    throw err;
  });

  const result = await getNutritionKnowledgeAnswer({
    question: "מה ההבדל בין פחמימות פשוטות למורכבות?",
    env: buildEnv(),
    openaiClient: client,
  });

  assert.equal(result.errorCode, "OPENAI_API_ERROR");
  assert.equal(result.usedFallback, true);
  assert.equal(result.shouldUseDefaultFlow, false);
  assert.equal(result.answer, SAFE_FALLBACK_HEBREW);
  assert.equal(JSON.stringify(result).includes("sk-secret-value"), false);
});

test("Responses request uses instructions and includes file_search diagnostics", async () => {
  const client = buildMockClient({ id: "resp_ok_diag", output_text: "תשובה" });

  await getNutritionKnowledgeAnswer({
    question: "מה הם מקורות טובים לחלבון?",
    env: buildEnv(),
    openaiClient: client,
  });

  assert.equal(client.calls.length, 1);
  assert.equal(typeof client.calls[0].instructions, "string");
  assert.deepEqual(client.calls[0].include, ["file_search_call.results"]);
  assert.equal(client.calls[0].input[0].role, "user");
});

test("Vector Store ID is passed to file_search tool", async () => {
  const client = buildMockClient({ id: "resp_ok_2", output_text: "תשובה" });

  await getNutritionKnowledgeAnswer({
    question: "למה חשוב לשתות מים?",
    env: buildEnv({ OPENAI_VECTOR_STORE_ID: "vs_expected" }),
    openaiClient: client,
  });

  assert.equal(client.calls.length, 1);
  const tool = client.calls[0].tools[0];
  assert.equal(tool.type, "file_search");
  assert.deepEqual(tool.vector_store_ids, ["vs_expected"]);
});

test("default file_search max results is 5", async () => {
  const client = buildMockClient({ id: "resp_ok_3", output_text: "תשובה" });

  await getNutritionKnowledgeAnswer({
    question: "מהי ארוחה מאוזנת?",
    env: buildEnv({ OPENAI_FILE_SEARCH_MAX_RESULTS: "" }),
    openaiClient: client,
  });

  const tool = client.calls[0].tools[0];
  assert.equal(tool.max_num_results, 5);
});

test("configured file_search max results is respected", async () => {
  const client = buildMockClient({ id: "resp_ok_4", output_text: "תשובה" });

  await getNutritionKnowledgeAnswer({
    question: "מהי ארוחה מאוזנת?",
    env: buildEnv({ OPENAI_FILE_SEARCH_MAX_RESULTS: "9" }),
    openaiClient: client,
  });

  const tool = client.calls[0].tools[0];
  assert.equal(tool.max_num_results, 9);
});

test("no fabricated citation is displayed when citations are absent", async () => {
  const client = buildMockClient({
    id: "resp_ok_5",
    output_text: "תשובה כללית",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "תשובה כללית", annotations: [] }],
      },
    ],
  });

  const result = await getNutritionKnowledgeAnswer({
    question: "מה הם מקורות טובים לחלבון?",
    env: buildEnv(),
    openaiClient: client,
  });

  assert.deepEqual(result.citations, []);
  assert.equal(result.usedFallback, true);
  assert.equal(result.errorCode, "NO_VERIFIED_CITATIONS");
  assert.equal(result.answer.includes("לא התקבל מקור מאומת בתשובה זו"), false);
  assert.equal(result.answer.includes("מקורות:"), false);
});

test("unsupported numerical weight-loss range is blocked", async () => {
  const client = buildMockClient({
    id: "resp_num_1",
    output_text: "קצב מומלץ הוא 0.5-1 קילו בשבוע.",
    output: [
      {
        type: "file_search_call",
        results: [
          {
            content: "הטקסט המאומת מדבר על ירידה הדרגתית בלבד ללא מספרים.",
          },
        ],
      },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "קצב מומלץ הוא 0.5-1 קילו בשבוע.",
            annotations: [
              {
                type: "file_citation",
                file_id: "file_abc",
                filename: "snap-eat-nutrition-knowledge.md",
                index: 0,
              },
            ],
          },
        ],
      },
    ],
  });

  const result = await getNutritionKnowledgeAnswer({
    question: "כמה קילו בשבוע כדאי לרדת?",
    env: buildEnv(),
    openaiClient: client,
  });

  assert.equal(result.usedFallback, true);
  assert.equal(result.errorCode, "UNSUPPORTED_NUMERIC_CLAIM");
  assert.equal(result.answer.includes("0.5-1"), false);
  assert.equal(
    result.answer.includes(VERIFIED_INFO_UNAVAILABLE_HEBREW)
      || result.answer.includes(EXTREME_WEIGHT_LOSS_SAFE_HEBREW),
    true
  );
});

test("extreme weight-loss request uses safe wording without exact rates", async () => {
  const client = buildMockClient({
    id: "resp_num_2",
    output_text: "אפשר לרדת 1-2 קילו בשבוע.",
    output: [
      {
        type: "file_search_call",
        results: [{ content: "ירידה הדרגתית ובטוחה." }],
      },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "אפשר לרדת 1-2 קילו בשבוע.",
            annotations: [
              {
                type: "file_citation",
                file_id: "file_abc",
                filename: "snap-eat-nutrition-knowledge.md",
                index: 0,
              },
            ],
          },
        ],
      },
    ],
  });

  const result = await getNutritionKnowledgeAnswer({
    question: "איך לרדת מהר וקיצוני במשקל?",
    env: buildEnv(),
    openaiClient: client,
  });

  assert.equal(result.usedFallback, true);
  assert.match(result.answer, /ירידה קיצונית ומהירה במשקל עלולה להיות לא בטוחה/);
  assert.match(result.answer, new RegExp(EXTREME_WEIGHT_LOSS_SAFE_HEBREW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("no personalized meal-plan offer is returned", async () => {
  const client = buildMockClient({
    id: "resp_plan_1",
    output_text: "אני יכולה לבנות לך תפריט אישי לשבוע.",
    output: [
      {
        type: "file_search_call",
        results: [{ content: "תוכן כללי בלבד." }],
      },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "אני יכולה לבנות לך תפריט אישי לשבוע.",
            annotations: [
              {
                type: "file_citation",
                file_id: "file_abc",
                filename: "snap-eat-nutrition-knowledge.md",
                index: 0,
              },
            ],
          },
        ],
      },
    ],
  });

  const result = await getNutritionKnowledgeAnswer({
    question: "תבני לי תפריט אישי",
    env: buildEnv(),
    openaiClient: client,
  });

  assert.equal(result.answer.includes("תפריט אישי"), false);
  assert.equal(result.answer.includes("תוכנית אישית צריך לפנות לדיאטנית רשומה"), true);
});

test("unsupported details return verified-information-unavailable wording", async () => {
  const client = buildMockClient({
    id: "resp_num_3",
    output_text: "כדאי לשתות 3 ליטר מים ביום.",
    output: [
      {
        type: "file_search_call",
        results: [{ content: "המקור המאומת לא מספק כמויות שתייה מדויקות." }],
      },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "כדאי לשתות 3 ליטר מים ביום.",
            annotations: [
              {
                type: "file_citation",
                file_id: "file_abc",
                filename: "snap-eat-nutrition-knowledge.md",
                index: 0,
              },
            ],
          },
        ],
      },
    ],
  });

  const result = await getNutritionKnowledgeAnswer({
    question: "כמה מים לשתות ביום?",
    env: buildEnv(),
    openaiClient: client,
  });

  assert.equal(result.usedFallback, true);
  assert.equal(result.answer.includes(VERIFIED_INFO_UNAVAILABLE_HEBREW), true);
  assert.equal(result.answer.includes("3 ליטר"), false);
});

test("sources are not displayed in user-facing answer when citations are absent", async () => {
  const client = buildMockClient({
    id: "resp_src_none",
    output_text: "תשובה כללית",
    output: [
      {
        type: "file_search_call",
        results: [{ content: "תוכן ללא ציטוטים" }],
      },
      {
        type: "message",
        content: [{ type: "output_text", text: "תשובה כללית", annotations: [] }],
      },
    ],
  });

  const result = await getNutritionKnowledgeAnswer({
    question: "מה ההבדל בין פחמימות?",
    env: buildEnv(),
    openaiClient: client,
  });

  assert.equal(result.answer.includes("מקורות:"), false);
  assert.equal(result.answer.includes("snap-eat-nutrition-knowledge.md"), false);
  assert.deepEqual(result.citations, []);
  assert.equal(result.errorCode, "NO_VERIFIED_CITATIONS");
});
