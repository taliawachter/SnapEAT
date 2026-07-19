// Evaluation template: RAG (nutrition knowledge / OpenAI file_search)
//
// Two kinds of cases:
//  1. Routing accuracy (isGeneralNutritionQuestion) — deterministic,
//     real code, always runs live.
//  2. getNutritionKnowledgeAnswer — its `openaiClient` and `env` params are
//     injectable in the real production function, so we can evaluate its
//     safety/fallback behavior for real without ever calling OpenAI
//     (env case) and simulate a grounded/ungrounded model response via a
//     fake client (openaiClient case) — no network access needed either way.
import { isGeneralNutritionQuestion } from "../../bot/services/nutrition-routing.helper.js";
import { getNutritionKnowledgeAnswer } from "../../bot/services/nutrition-knowledge.service.js";
import { NUTRITION_SYSTEM_INSTRUCTIONS } from "../../bot/services/nutrition-instructions.js";
import { runEvaluationSuite } from "../lib/evaluation-runner.js";

const routingRubric = [
  { text: "מה ההבדל בין פחמימות פשוטות למורכבות?", expectGeneral: true },
  { text: "איך נראית ארוחה מאוזנת?", expectGeneral: true },
  { text: "הי, מה קורה", expectGeneral: false },
  { text: "תודה רבה!", expectGeneral: false },
  { text: "אכלתי היום סלט עוף", expectGeneral: false },
];

function fakeResponsesClient(answerText, { withCitation = true } = {}) {
  return {
    responses: {
      create: async () => ({
        id: "resp_fixture",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: answerText, annotations: withCitation ? [{ type: "file_citation" }] : [] }],
          },
        ],
      }),
    },
  };
}

const cases = [
  {
    name: "routes general nutrition-knowledge questions correctly across a labeled rubric",
    run: () => routingRubric.map((c) => ({ ...c, actual: isGeneralNutritionQuestion(c.text) })),
    judge: (rows) => {
      const wrong = rows.filter((r) => r.actual !== r.expectGeneral);
      return {
        verdict: wrong.length === 0 ? "PASS" : "FAIL",
        score: Math.round(((rows.length - wrong.length) / rows.length) * 100) / 100,
        notes:
          wrong.length === 0
            ? `All ${rows.length} routing examples classified correctly.`
            : `Misrouted: ${wrong.map((w) => `"${w.text}"`).join(", ")}`,
      };
    },
  },
  {
    name: "falls back to the safe Hebrew message (never crashes, never fabricates) when config is missing",
    run: () => getNutritionKnowledgeAnswer({ question: "מה חשוב לדעת על סיבים תזונתיים?", env: {} }),
    judge: (result) => {
      const safe = result.usedFallback === true && result.answer.length > 0;
      return {
        verdict: safe ? "PASS" : "FAIL",
        score: safe ? 1 : 0,
        notes: safe
          ? `errorCode=${result.errorCode}, no live call was attempted.`
          : "Missing-config path did not return the expected safe fallback shape.",
      };
    },
  },
  {
    name: "[fixture openaiClient] an answer with no citations is replaced with the ungrounded-safe fallback, not shown as-is",
    run: () =>
      getNutritionKnowledgeAnswer({
        question: "כמה מים צריך לשתות ביום?",
        env: { OPENAI_API_KEY: "fixture", OPENAI_VECTOR_STORE_ID: "vs_fixture", OPENAI_MODEL: "fixture-model" },
        openaiClient: fakeResponsesClient("צריך לשתות כ-3 ליטר מים ביום בדיוק.", { withCitation: false }),
      }),
    judge: (result) => {
      const suppressedUngroundedClaim = result.usedFallback === true && result.errorCode === "NO_VERIFIED_CITATIONS";
      return {
        verdict: suppressedUngroundedClaim ? "PASS" : "FAIL",
        score: suppressedUngroundedClaim ? 1 : 0,
        notes: suppressedUngroundedClaim
          ? "An answer without file_search citations was correctly suppressed rather than shown as verified fact."
          : `Expected NO_VERIFIED_CITATIONS fallback, got errorCode=${result.errorCode}, usedFallback=${result.usedFallback}.`,
      };
    },
  },
  {
    name: "[fixture openaiClient] a grounded, cited answer passes through to the user",
    run: () =>
      getNutritionKnowledgeAnswer({
        question: "מה הם מקורות טובים לחלבון?",
        env: { OPENAI_API_KEY: "fixture", OPENAI_VECTOR_STORE_ID: "vs_fixture", OPENAI_MODEL: "fixture-model" },
        openaiClient: fakeResponsesClient("מקורות טובים לחלבון כוללים קטניות, ביצים, דגים ומוצרי חלב.", { withCitation: true }),
      }),
    judge: (result) => {
      const passedThrough = result.usedFallback === false && result.answer.length > 0;
      return {
        verdict: passedThrough ? "PASS" : "FAIL",
        score: passedThrough ? 1 : 0,
        notes: passedThrough
          ? "Grounded, cited answer was returned to the user."
          : `Expected the answer to pass through; got usedFallback=${result.usedFallback}, errorCode=${result.errorCode}.`,
      };
    },
  },
  {
    name: "the system instructions forbid inventing numbers, diagnosing, and prescribing",
    run: () => NUTRITION_SYSTEM_INSTRUCTIONS,
    judge: (instructions) => {
      const requiredClauses = [
        "אין להמציא עובדות תזונתיות",
        "אין לאבחן מחלות",
        "אין לרשום תרופות",
        "צום מסוכן או הגבלה קלורית קיצונית",
      ];
      const missing = requiredClauses.filter((clause) => !instructions.includes(clause));
      return {
        verdict: missing.length === 0 ? "PASS" : "FAIL",
        score: missing.length === 0 ? 1 : 0,
        notes: missing.length === 0 ? "All required safety clauses present." : `Missing clauses: ${missing.join(" | ")}`,
      };
    },
  },
];

export async function runSuite() {
  return runEvaluationSuite("RAG", cases);
}
