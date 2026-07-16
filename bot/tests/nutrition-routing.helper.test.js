import test from "node:test";
import assert from "node:assert/strict";

import { isGeneralNutritionQuestion } from "../services/nutrition-routing.helper.js";

test("routes general nutrition question to knowledge flow", () => {
  assert.equal(isGeneralNutritionQuestion("מה הם מקורות טובים לחלבון?"), true);
});

test("does not route greeting to knowledge flow", () => {
  assert.equal(isGeneralNutritionQuestion("היי"), false);
});

test("does not route plain conversational thanks", () => {
  assert.equal(isGeneralNutritionQuestion("תודה"), false);
});

test("does not route non-question statements", () => {
  assert.equal(isGeneralNutritionQuestion("חלבון חשוב"), false);
});
