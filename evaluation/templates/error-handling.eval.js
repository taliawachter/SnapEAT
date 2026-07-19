// Evaluation template: Error Handling
//
// A matrix of induced failures (network down, malformed upstream response,
// classifier crash, invalid input, upstream API error) run against the
// REAL production services, using their injectable seams (fetchImpl,
// classifyImpl, openaiClient) to simulate the failure without touching a
// real network or API. The rubric: every failure must (a) not throw an
// unhandled exception, (b) return a safe, structured result, and (c) never
// leak stack traces, raw error messages, or secrets to the eventual
// user-facing text.
import {
  getProductByBarcode,
  calculateNutritionForWeight,
  formatProductNutritionForUser,
} from "../../bot/services/food-product.service.js";
import { classifyPackagedProductImage } from "../../bot/services/packaged-product-image.service.js";
import { getNutritionKnowledgeAnswer } from "../../bot/services/nutrition-knowledge.service.js";
import { runEvaluationSuite } from "../lib/evaluation-runner.js";

const SECRET_LOOKING_PATTERNS = [/sk-[a-zA-Z0-9]{10,}/, /Bearer [a-zA-Z0-9._-]{10,}/, /at [A-Za-z]+\.[A-Za-z]+ \(/];

function leaksSomethingSensitive(text) {
  return SECRET_LOOKING_PATTERNS.some((pattern) => pattern.test(text));
}

const cases = [
  {
    name: "barcode lookup: a network failure (fetch throws) degrades to a safe structured error",
    run: () =>
      getProductByBarcode("7290000000000", {
        fetchImpl: async () => {
          throw new Error("getaddrinfo ENOTFOUND world.openfoodfacts.org");
        },
      }),
    judge: (result) => {
      const safe = result.found === false && result.errorCode === "PRODUCT_LOOKUP_FAILED";
      return {
        verdict: safe ? "PASS" : "FAIL",
        score: safe ? 1 : 0,
        notes: safe ? "Network failure mapped to PRODUCT_LOOKUP_FAILED without throwing." : `Unexpected result: ${JSON.stringify(result)}`,
      };
    },
  },
  {
    name: "barcode lookup: a malformed (non-JSON) upstream response does not crash the bot",
    run: () =>
      getProductByBarcode("7290000000000", {
        fetchImpl: async () => ({
          ok: true,
          json: async () => {
            throw new SyntaxError("Unexpected token < in JSON");
          },
        }),
      }),
    judge: (result) => {
      const safe = result.found === false && result.errorCode === "PRODUCT_LOOKUP_FAILED";
      return {
        verdict: safe ? "PASS" : "FAIL",
        score: safe ? 1 : 0,
        notes: safe ? "Malformed upstream JSON handled safely." : `Unexpected result: ${JSON.stringify(result)}`,
      };
    },
  },
  {
    name: "barcode lookup: an HTTP error status (e.g. 500) is treated as lookup failure, not 'product not found'",
    run: () => getProductByBarcode("7290000000000", { fetchImpl: async () => ({ ok: false, status: 500 }) }),
    judge: (result) => {
      const correct = result.errorCode === "PRODUCT_LOOKUP_FAILED";
      return {
        verdict: correct ? "PASS" : "FAIL",
        score: correct ? 1 : 0,
        notes: correct
          ? "Upstream 5xx correctly distinguished from a genuine not-found."
          : `Got errorCode=${result.errorCode}; a 500 must not be reported to the user as 'product not found'.`,
      };
    },
  },
  {
    name: "packaged-product image classifier: a crashing classifier falls back to UNKNOWN, never throws",
    run: () =>
      classifyPackagedProductImage("fake-image-data", {
        classifyImpl: async () => {
          throw new Error("model timeout after 30000ms");
        },
      }),
    judge: (result) => {
      const safe = result.classification === "UNKNOWN" && result.errorCode === "CLASSIFICATION_FAILED";
      return {
        verdict: safe ? "PASS" : "FAIL",
        score: safe ? 1 : 0,
        notes: safe ? "Classifier crash safely degrades to UNKNOWN." : `Unexpected result: ${JSON.stringify(result)}`,
      };
    },
  },
  {
    name: "nutrition calculation: invalid weight input (NaN, negative, absurdly large) never throws",
    run: () => [NaN, -50, 10_000_000].map((w) => calculateNutritionForWeight({ calories: 100 }, w)),
    judge: (results) => {
      const allSafe = results.every((r) => r.ok === false && r.errorCode === "INVALID_WEIGHT");
      return {
        verdict: allSafe ? "PASS" : "FAIL",
        score: allSafe ? 1 : 0,
        notes: allSafe
          ? "All three invalid-weight inputs rejected with a structured error."
          : `Some invalid inputs were not rejected: ${JSON.stringify(results)}`,
      };
    },
  },
  {
    name: "product formatting: a product with no nutrition data at all still renders without throwing",
    run: () => formatProductNutritionForUser({ name: "מוצר ללא נתונים", nutritionPer100g: {} }),
    judge: (text) => {
      const safe = typeof text === "string" && text.length > 0;
      return {
        verdict: safe ? "PASS" : "FAIL",
        score: safe ? 1 : 0,
        notes: safe ? "Empty-nutrition product still produced user-facing text." : "Formatter returned empty/invalid output.",
      };
    },
  },
  {
    name: "RAG: an OpenAI API error never leaks the exception message or stack to the user-facing answer",
    run: () =>
      getNutritionKnowledgeAnswer({
        question: "מה חשוב לדעת על ברזל בתזונה?",
        env: { OPENAI_API_KEY: "sk-fixture-secret-value-123456", OPENAI_VECTOR_STORE_ID: "vs_1", OPENAI_MODEL: "m1" },
        openaiClient: {
          responses: {
            create: async () => {
              throw new Error("Request failed: Authorization: Bearer sk-fixture-secret-value-123456");
            },
          },
        },
      }),
    judge: (result) => {
      const leaked = leaksSomethingSensitive(result.answer);
      return {
        verdict: !leaked && result.usedFallback ? "PASS" : "FAIL",
        score: !leaked && result.usedFallback ? 1 : 0,
        notes: leaked
          ? "LEAK: the safe-fallback answer text contains something that looks like a secret or stack frame."
          : "OpenAI failure produced a clean safe-fallback answer with no leaked internals.",
      };
    },
  },
];

export async function runSuite() {
  return runEvaluationSuite("Error Handling", cases);
}
