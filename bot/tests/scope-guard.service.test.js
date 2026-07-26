import test from "node:test";
import assert from "node:assert/strict";
import {
  isNutritionRelatedMessage,
  getOutOfScopeReply,
  getScopedAssistantReply,
  isGreetingMessage,
  getGreetingReply,
} from "../services/scope-guard.service.js";

test("allows nutrition-related questions", () => {
  assert.equal(isNutritionRelatedMessage("כמה חלבון יש בטונה?"), true);
  assert.equal(isNutritionRelatedMessage("מה כדאי לאכול אחרי אימון?"), true);
  assert.equal(isNutritionRelatedMessage("תנתח לי את הארוחה"), true);
  assert.equal(isNutritionRelatedMessage("סרקתי ברקוד"), true);
  assert.equal(isNutritionRelatedMessage("חצי אריזה"), true);
  assert.equal(isNutritionRelatedMessage("איך מוחקים ארוחה?"), true);
  assert.equal(isNutritionRelatedMessage("מה אכלתי היום?"), true);
});

test("rejects unrelated travel and shopping requests", () => {
  assert.equal(isNutritionRelatedMessage("תן לי המלצות ליעדי טיול"), false);
  assert.equal(isNutritionRelatedMessage("איזה תיק מומלץ ללימודים?"), false);
  assert.equal(isNutritionRelatedMessage("תמליץ לי על מלון"), false);
  assert.equal(isNutritionRelatedMessage("איך לומדים JavaScript?"), false);
  assert.equal(isNutritionRelatedMessage("מי ניצח במשחק?"), false);
  assert.equal(isNutritionRelatedMessage("איזה מחשב כדאי לקנות?"), false);
});

test("preserves pending flows for short answers", () => {
  assert.equal(isNutritionRelatedMessage("כן", { step: "awaiting_confirmation" }), true);
  assert.equal(isNutritionRelatedMessage("לא", { step: "awaiting_confirmation" }), true);
  assert.equal(isNutritionRelatedMessage("חצי", { step: "awaiting_product_amount" }), true);
  assert.equal(isNutritionRelatedMessage("200 גרם", { step: "awaiting_product_amount" }), true);
  assert.equal(isNutritionRelatedMessage("ארוחת ערב", { step: "awaiting_meal_type" }), true);
});

test("returns the greeting response for common greetings", async () => {
  for (const text of ["היי", "שלום", "בוקר טוב"]) {
    let calls = 0;
    const result = await getScopedAssistantReply({
      userText: text,
      pendingState: null,
      generateReplyFn: async () => {
        calls += 1;
        return "should not run";
      },
    });

    assert.equal(isGreetingMessage(text), true);
    assert.equal(result.shouldCallOpenAI, false);
    assert.equal(calls, 0);
    assert.equal(result.reply, getGreetingReply());
  }
});

test("preserves pending flows by not treating greetings as out-of-scope", async () => {
  let calls = 0;
  const result = await getScopedAssistantReply({
    userText: "שלום",
    pendingState: { step: "awaiting_confirmation" },
    generateReplyFn: async () => {
      calls += 1;
      return "continue flow";
    },
  });

  assert.equal(result.shouldCallOpenAI, true);
  assert.equal(calls, 1);
  assert.equal(result.reply, "continue flow");
});

test("returns the exact out-of-scope response and skips OpenAI", async () => {
  let calls = 0;
  const result = await getScopedAssistantReply({
    userText: "איזה תיק מומלץ?",
    pendingState: null,
    generateReplyFn: async () => {
      calls += 1;
      return "should not run";
    },
  });

  assert.equal(result.shouldCallOpenAI, false);
  assert.equal(calls, 0);
  assert.equal(result.reply, getOutOfScopeReply());
});
