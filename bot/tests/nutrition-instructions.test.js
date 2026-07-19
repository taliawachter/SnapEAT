import test from "node:test";
import assert from "node:assert/strict";

import {
  NUTRITION_SYSTEM_INSTRUCTIONS,
  buildNutritionContextBlock,
} from "../services/nutrition-instructions.js";

test("NUTRITION_SYSTEM_INSTRUCTIONS forbids inventing nutrition facts", () => {
  assert.match(NUTRITION_SYSTEM_INSTRUCTIONS, /אין להמציא עובדות תזונתיות/);
});

test("NUTRITION_SYSTEM_INSTRUCTIONS forbids medical diagnosis and prescribing", () => {
  assert.match(NUTRITION_SYSTEM_INSTRUCTIONS, /אין לאבחן מחלות/);
  assert.match(NUTRITION_SYSTEM_INSTRUCTIONS, /אין לרשום תרופות/);
});

test("NUTRITION_SYSTEM_INSTRUCTIONS forbids dangerous restriction advice", () => {
  assert.match(NUTRITION_SYSTEM_INSTRUCTIONS, /צום מסוכן או הגבלה קלורית קיצונית/);
});

test("NUTRITION_SYSTEM_INSTRUCTIONS requires the exact safe fallback wording when data is insufficient", () => {
  assert.match(
    NUTRITION_SYSTEM_INSTRUCTIONS,
    /אין לי כרגע מספיק מידע מאומת במאגר כדי לענות על החלק הזה במדויק\./
  );
});

test("NUTRITION_SYSTEM_INSTRUCTIONS has no leading/trailing whitespace (it's spliced directly into a prompt)", () => {
  assert.equal(NUTRITION_SYSTEM_INSTRUCTIONS, NUTRITION_SYSTEM_INSTRUCTIONS.trim());
});

test("buildNutritionContextBlock fills in all three sections when provided", () => {
  const block = buildNutritionContextBlock({
    userProfileSummary: "female, 30yo",
    memorySummary: "prefers vegetarian",
    mealInfoSummary: "500 kcal salad",
  });

  assert.match(block, /User profile summary: female, 30yo/);
  assert.match(block, /Memory summary: prefers vegetarian/);
  assert.match(block, /Meal information summary \(application-calculated\): 500 kcal salad/);
});

test("buildNutritionContextBlock defaults every missing section to 'none' instead of throwing", () => {
  const block = buildNutritionContextBlock();

  assert.match(block, /User profile summary: none/);
  assert.match(block, /Memory summary: none/);
  assert.match(block, /Meal information summary \(application-calculated\): none/);
});

test("buildNutritionContextBlock truncates an oversized section instead of unbounded prompt growth", () => {
  const huge = "x".repeat(5000);
  const block = buildNutritionContextBlock({ userProfileSummary: huge });

  const line = block.split("\n").find((l) => l.startsWith("- User profile summary:"));
  assert.ok(line.length < 1300, `expected truncated line, got length ${line.length}`);
});

test("buildNutritionContextBlock always starts with the CONTEXT marker so the model can distinguish it from instructions", () => {
  const block = buildNutritionContextBlock({});
  assert.match(block, /^\[CONTEXT - USE AS SUPPORT ONLY\]/);
});
