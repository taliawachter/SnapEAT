import test from "node:test";
import assert from "node:assert/strict";
import {
  isNutritionRelatedMessage,
  getOutOfScopeReply,
  getScopedAssistantReply,
  isGreetingMessage,
  getGreetingReply,
  debugNutritionScopeDecision,
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

test("treats general nutrition advice and meal planning as in scope", () => {
  for (const text of [
    "מה אני צריכה לאכול בשביל לרדת במשקל?",
    "מה אני צריכה לאכול בשביל לעלות במשקל?",
    "תעשה לי תפריט מתאים.",
    "תבנה לי תפריט.",
    "מה כדאי לאכול?",
    "מה לאכול בערב?",
    "מה לאכול אחרי אימון?",
    "מה כדאי לאכול בבוקר?",
    "כמה ארוחות כדאי לאכול?",
    "איך לרדת במשקל?",
    "איך לעלות במשקל?",
    "איך לבנות מסת שריר?",
  ]) {
    assert.equal(isNutritionRelatedMessage(text), true, text);
  }
});

test("rejects unrelated travel and shopping requests", () => {
  assert.equal(isNutritionRelatedMessage("תן לי המלצות ליעדי טיול"), false);
  assert.equal(isNutritionRelatedMessage("איזה תיק מומלץ ללימודים?"), false);
  assert.equal(isNutritionRelatedMessage("תמליץ לי על מלון"), false);
  assert.equal(isNutritionRelatedMessage("איך לומדים JavaScript?"), false);
  assert.equal(isNutritionRelatedMessage("מי ניצח במשחק?"), false);
  assert.equal(isNutritionRelatedMessage("איזה מחשב כדאי לקנות?"), false);
});

test("rejects unrelated travel, shopping and tech requests (regression)", () => {
  assert.equal(isNutritionRelatedMessage("איזה תיק כדאי לקנות?"), false);
  assert.equal(isNutritionRelatedMessage("לאן כדאי לטוס?"), false);
  assert.equal(isNutritionRelatedMessage("איך לתקן את המחשב?"), false);
  assert.equal(isNutritionRelatedMessage("איזה טלפון מומלץ?"), false);
});

test("classifies explicit meal-planning questions as in scope", () => {
  assert.equal(isNutritionRelatedMessage("מה אני צריכה לאכול", null), true);
  assert.equal(
    isNutritionRelatedMessage("מה אני צריכה לאכול בשביל לרדת במשקל", null),
    true
  );
  assert.equal(isNutritionRelatedMessage("תכין לי תפריט מתאים", null), true);
});

test("lets explicit nutrition intent override a homograph blocklist word", () => {
  // "מלון" is blocklisted as "hotel" but is also the Hebrew word for
  // "melon" - a food term. When the message also carries clear nutrition
  // intent (e.g. "אכלתי"/"קלוריות"), that intent must win.
  assert.equal(isNutritionRelatedMessage("אכלתי מלון היום"), true);
  assert.equal(isNutritionRelatedMessage("כמה קלוריות יש בפרוסת מלון"), true);

  // Without any nutrition signal, "מלון" is still treated as "hotel".
  assert.equal(isNutritionRelatedMessage("תמליץ לי על מלון"), false);
});

test("debugNutritionScopeDecision exposes which rule decided the result", () => {
  assert.deepEqual(debugNutritionScopeDecision("", null), {
    pendingStep: null,
    normalizedText: "",
    allowedMatch: null,
    advicePatternMatch: null,
    blocklistMatch: null,
    decidedBy: "empty_text",
    result: false,
  });

  assert.deepEqual(debugNutritionScopeDecision("חצי", { step: "awaiting_product_amount" }), {
    pendingStep: "awaiting_product_amount",
    normalizedText: "חצי",
    allowedMatch: null,
    advicePatternMatch: null,
    blocklistMatch: null,
    decidedBy: "pending_flow",
    result: true,
  });

  const allowedDecision = debugNutritionScopeDecision("מה אני צריכה לאכול", null);
  assert.equal(allowedDecision.decidedBy, "allowed_term");
  assert.equal(allowedDecision.allowedMatch, "לאכול");
  assert.equal(allowedDecision.result, true);

  const adviceDecision = debugNutritionScopeDecision("תכין לי תפריט מתאים", null);
  assert.equal(adviceDecision.decidedBy, "allowed_term");
  assert.equal(adviceDecision.allowedMatch, "תפריט");
  assert.equal(adviceDecision.result, true);

  const blocklistDecision = debugNutritionScopeDecision("איזה מחשב כדאי לקנות?", null);
  assert.equal(blocklistDecision.decidedBy, "blocklist_term");
  assert.equal(blocklistDecision.blocklistMatch, "לקנות");
  assert.equal(blocklistDecision.result, false);

  const overrideDecision = debugNutritionScopeDecision("אכלתי מלון היום", null);
  assert.equal(overrideDecision.decidedBy, "allowed_term");
  assert.equal(overrideDecision.allowedMatch, "אכלתי");
  assert.equal(overrideDecision.blocklistMatch, "מלון");
  assert.equal(overrideDecision.result, true);
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
