import test from "node:test";
import assert from "node:assert/strict";
import {
  UNKNOWN_ESTIMATE_TEXT,
  UNKNOWN_QUANTITY_TEXT,
  canonicalAnalysisToLegacyText,
  formatEstimatedNumericDisplay,
  formatEstimatedQuantityDisplay,
  mergeMissingMealAnalysisFields,
  normalizeMealAnalysis,
  normalizeMealRecordForDisplay,
} from "../../shared/meal-analysis.js";

test("1. Complete valid model response remains intact", () => {
  const analysis = normalizeMealAnalysis({
    mealName: "סושי",
    ingredients: [
      {
        name: "רול סושי",
        estimatedQuantity: "2 חתיכות סושי",
        estimatedQuantityGrams: 80,
        calories: 120,
        proteinGrams: 4,
        carbohydratesGrams: 18,
        fatGrams: 3,
        confidence: 0.9,
      },
    ],
    totalCalories: 120,
    totalProteinGrams: 4,
    totalCarbohydratesGrams: 18,
    totalFatGrams: 3,
    confidence: 0.9,
  });

  assert.equal(analysis.mealName, "סושי");
  assert.equal(analysis.totalCalories, 120);
  assert.equal(analysis.ingredients[0].estimatedQuantity, "2 חתיכות סושי");
});

test("2. Numeric strings converted to numbers", () => {
  const analysis = normalizeMealAnalysis({
    mealName: "קוואקר",
    ingredients: [{
      name: "בננה",
      estimatedQuantity: "כ־120 גרם",
      calories: "105",
      proteinGrams: "1.3",
      carbohydratesGrams: "27",
      fatGrams: "0.4",
    }],
    totalCalories: "105 קלוריות",
    totalProteinGrams: "1.3 גרם",
    totalCarbohydratesGrams: "27",
    totalFatGrams: "0.4",
  });

  assert.equal(analysis.totalCalories, 105);
  assert.equal(analysis.ingredients[0].estimatedQuantityGrams, 120);
});

test("3. Missing totals calculated from ingredients", () => {
  const analysis = normalizeMealAnalysis({
    mealName: "שיבולת שועל",
    ingredients: [
      { name: "קוואקר", calories: 150, proteinGrams: 5, carbohydratesGrams: 27, fatGrams: 3 },
      { name: "בננה", calories: 105, proteinGrams: 1.3, carbohydratesGrams: 27, fatGrams: 0.4 },
    ],
  });

  assert.equal(analysis.totalCalories, 255);
  assert.equal(analysis.totalProteinGrams, 6.3);
  assert.ok(analysis.estimationNotes.some((note) => note.includes("קלוריות")));
});

test("4. Missing ingredient quantity displayed as estimated unknown", () => {
  const analysis = normalizeMealAnalysis({
    mealName: "דייסה",
    ingredients: [{ name: "תותים" }],
  });

  assert.equal(formatEstimatedQuantityDisplay(analysis.ingredients[0]), UNKNOWN_QUANTITY_TEXT);
});

test("5. 'לא זמין' rejected from numeric fields", () => {
  const analysis = normalizeMealAnalysis({
    mealName: "דייסה",
    ingredients: [{
      name: "תותים",
      calories: "לא זמין",
      proteinGrams: "לא זמין",
    }],
  });

  assert.equal(analysis.ingredients[0].calories, null);
  assert.equal(analysis.ingredients[0].proteinGrams, null);
});

test("6. Negative values normalized to zero/null-safe numbers", () => {
  const analysis = normalizeMealAnalysis({
    mealName: "מנה",
    totalCalories: -50,
    ingredients: [{ name: "רכיב", calories: -10, proteinGrams: -2, carbohydratesGrams: -3, fatGrams: -1 }],
  });

  assert.equal(analysis.totalCalories, 0);
  assert.equal(analysis.ingredients[0].calories, 0);
  assert.equal(analysis.ingredients[0].proteinGrams, 0);
});

test("7. Macro calorie discrepancy creates warning and correction", () => {
  const analysis = normalizeMealAnalysis({
    mealName: "דייסה",
    totalCalories: 100,
    totalProteinGrams: 10,
    totalCarbohydratesGrams: 20,
    totalFatGrams: 10,
  });

  assert.equal(analysis.totalCalories, 210);
  assert.ok(analysis.estimationNotes.some((note) => note.includes("מאקרו")));
});

test("8. Legacy Firestore document normalized correctly", () => {
  const normalized = normalizeMealRecordForDisplay({
    mealName: "סושי",
    totalCalories: 240,
    protein: 8,
    carbs: 30,
    fat: 5,
    ingredients: [{ name: "סושי", quantity: "2 חתיכות", calories: 240, protein: 8, carbs: 30, fat: 5 }],
  });

  assert.equal(normalized.totalCalories, 240);
  assert.equal(normalized.ingredients[0].estimatedQuantity, "2 חתיכות");
});

test("9. Empty AI response fails gracefully into unknown estimate structure", () => {
  const normalized = normalizeMealAnalysis(null);
  assert.equal(normalized.totalCalories, 0);
  assert.ok(normalized.estimationNotes.includes(UNKNOWN_ESTIMATE_TEXT));
});

test("10. Partial response repaired or merged with uncertainty preserved", () => {
  const merged = mergeMissingMealAnalysisFields(
    {
      mealName: "דייסה",
      ingredients: [{ name: "קוואקר", estimatedQuantity: null, calories: null, proteinGrams: null, carbohydratesGrams: null, fatGrams: null }],
      totalCalories: 0,
    },
    {
      mealName: "דייסה",
      ingredients: [{ name: "קוואקר", estimatedQuantity: "קערה בינונית, כ־250 גרם", estimatedQuantityGrams: 250, calories: 220, proteinGrams: 8, carbohydratesGrams: 36, fatGrams: 4 }],
      totalCalories: 220,
      totalProteinGrams: 8,
      totalCarbohydratesGrams: 36,
      totalFatGrams: 4,
    },
  );

  assert.equal(merged.totalCalories, 220);
  assert.equal(merged.ingredients[0].estimatedQuantityGrams, 250);
});

test("11. Frontend-safe formatter never renders undefined or NaN", () => {
  assert.equal(formatEstimatedNumericDisplay(undefined, " גרם"), UNKNOWN_ESTIMATE_TEXT);
  assert.equal(formatEstimatedNumericDisplay("NaN", " גרם"), UNKNOWN_ESTIMATE_TEXT);
});

test("12. Existing complete sushi meal legacy text remains renderable", () => {
  const text = canonicalAnalysisToLegacyText({
    mealName: "סושי",
    ingredients: [{
      name: "רול סושי",
      estimatedQuantity: "2 חתיכות סושי",
      estimatedQuantityGrams: 80,
      calories: 120,
      proteinGrams: 4,
      carbohydratesGrams: 18,
      fatGrams: 3,
      confidence: 0.9,
    }],
    totalCalories: 120,
    totalProteinGrams: 4,
    totalCarbohydratesGrams: 18,
    totalFatGrams: 3,
    confidence: 0.9,
    estimationNotes: [],
  });

  assert.ok(text.includes("2 חתיכות סושי"));
  assert.ok(text.includes("קלוריות: 120 קל׳"));
});
