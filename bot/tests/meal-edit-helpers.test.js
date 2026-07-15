import test from "node:test";
import assert from "node:assert/strict";

import {
  applyMealUpdateLocally,
  buildCanonicalMealUpdatePayload,
  cancelMealEditState,
  extractBearerToken,
  normalizeMealForEdit,
  openMealEditState,
  recalculateTotalsFromIngredients,
  validateMealEditDraft,
} from "../../shared/meal-edit.js";

test("pencil open state points to correct meal", () => {
  const state = openMealEditState("meal-42", { mealName: "סלט" });
  assert.equal(state.isOpen, true);
  assert.equal(state.mealId, "meal-42");
});

test("form is pre-filled from existing meal", () => {
  const draft = normalizeMealForEdit({
    mealType: "lunch",
    analysis: {
      mealName: "פסטה",
      totalCalories: 620,
      totalProteinGrams: 20,
      totalCarbohydratesGrams: 70,
      totalFatGrams: 18,
      ingredients: [{ name: "פסטה", estimatedQuantity: "200 גרם", calories: 420 }],
    },
  });

  assert.equal(draft.mealName, "פסטה");
  assert.equal(draft.totalCalories, 620);
  assert.equal(draft.ingredients[0].name, "פסטה");
});

test("meal name updates in canonical payload", () => {
  const validated = validateMealEditDraft({
    mealName: "  כריך טונה  ",
    mealType: "lunch",
    totalCalories: "450",
    totalProteinGrams: "25",
    totalCarbohydratesGrams: "35",
    totalFatGrams: "12",
    ingredients: [{ name: "טונה", estimatedQuantity: "100 גרם" }],
  });

  assert.equal(validated.ok, true);
  const payload = buildCanonicalMealUpdatePayload(validated.draft);
  assert.equal(payload.mealName, "כריך טונה");
});

test("calories and macros update in payload", () => {
  const validated = validateMealEditDraft({
    mealName: "יוגורט",
    mealType: "breakfast",
    totalCalories: "300",
    totalProteinGrams: "20",
    totalCarbohydratesGrams: "30",
    totalFatGrams: "8",
    ingredients: [{ name: "יוגורט", estimatedQuantity: "1 גביע" }],
  });

  const payload = buildCanonicalMealUpdatePayload(validated.draft);
  assert.equal(payload.totalCalories, 300);
  assert.equal(payload.totalProteinGrams, 20);
  assert.equal(payload.totalCarbohydratesGrams, 30);
  assert.equal(payload.totalFatGrams, 8);
});

test("ingredient edits persist in payload", () => {
  const validated = validateMealEditDraft({
    mealName: "סלט",
    mealType: "dinner",
    totalCalories: "240",
    ingredients: [
      {
        name: "מלפפון",
        estimatedQuantity: "120 גרם",
        calories: "20",
        proteinGrams: "1",
        carbohydratesGrams: "3",
        fatGrams: "0",
      },
    ],
  });

  const payload = buildCanonicalMealUpdatePayload(validated.draft);
  assert.equal(payload.ingredients.length, 1);
  assert.equal(payload.ingredients[0].name, "מלפפון");
  assert.equal(payload.ingredients[0].calories, 20);
});

test("negative numeric values are rejected", () => {
  const validated = validateMealEditDraft({
    mealName: "שקשוקה",
    mealType: "breakfast",
    totalCalories: "-10",
    ingredients: [{ name: "ביצה", calories: "-5" }],
  });

  assert.equal(validated.ok, false);
  assert.ok(validated.errors.some((error) => error.includes("לא שלילי")));
});

test("legacy meal normalizes for edit form", () => {
  const draft = normalizeMealForEdit({
    mealType: "lunch",
    analysisText: [
      "זיהיתי: אורז",
      "רכיבים מפורטים:",
      "אורז | כמות: 180 גרם | פחמימות: 50 גרם | שומנים: 2 גרם | חלבונים: 4 גרם | קלוריות: 220 קל׳",
      "הערכה סבירה: 220",
      "חלבון: 4",
      "פחמימות: 50",
      "שומן: 2",
    ].join("\n"),
  });

  assert.equal(draft.mealName, "אורז");
  assert.equal(draft.ingredients.length, 1);
  assert.equal(draft.totalCalories, 220);
});

test("existing meal is updated without duplication", () => {
  const entries = [
    { id: "m1", mealName: "ישן" },
    { id: "m2", mealName: "נשאר" },
  ];

  const next = applyMealUpdateLocally(entries, "m1", { mealName: "חדש" });
  assert.equal(next.length, 2);
  assert.equal(next[0].mealName, "חדש");
});

test("imageUrl and createdAt are preserved when not included in update patch", () => {
  const entries = [
    {
      id: "m1",
      mealName: "מרק",
      imageUrl: "/uploads/a.jpg",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  const next = applyMealUpdateLocally(entries, "m1", { mealName: "מרק ירקות" });
  assert.equal(next[0].imageUrl, "/uploads/a.jpg");
  assert.equal(next[0].createdAt, "2026-01-01T00:00:00.000Z");
});

test("cancel restores original meal draft", () => {
  const opened = openMealEditState("m1", { mealName: "סלט", totalCalories: 300 });
  opened.draft.mealName = "שונה";

  const closed = cancelMealEditState(opened);
  assert.equal(closed.isOpen, false);
  assert.equal(closed.draft.mealName, "סלט");
});

test("unauthorized update request is rejected by missing bearer token", () => {
  assert.equal(extractBearerToken(""), null);
  assert.equal(extractBearerToken("Basic abc"), null);
  assert.equal(extractBearerToken("Bearer token-value"), "token-value");
});

test("recalculate totals supports immediate UI refresh values", () => {
  const totals = recalculateTotalsFromIngredients([
    { calories: 100, proteinGrams: 10, carbohydratesGrams: 5, fatGrams: 2 },
    { calories: 200, proteinGrams: 15, carbohydratesGrams: 20, fatGrams: 8 },
  ]);

  assert.equal(totals.totalCalories, 300);
  assert.equal(totals.totalProteinGrams, 25);
  assert.equal(totals.totalCarbohydratesGrams, 25);
  assert.equal(totals.totalFatGrams, 10);
  assert.equal(totals.hasAny, true);
});

test("macro-calorie mismatch is warning only and does not block valid save", () => {
  const validated = validateMealEditDraft({
    mealName: "מנה מותאמת",
    mealType: "lunch",
    totalCalories: "1000",
    totalProteinGrams: "100",
    totalCarbohydratesGrams: "0",
    totalFatGrams: "80",
    ingredients: [{ name: "רכיב", estimatedQuantity: "100 גרם" }],
  });

  assert.equal(validated.ok, true);
  assert.ok(typeof validated.mismatchWarning === "string" && validated.mismatchWarning.length > 0);
});

test("NaN and Infinity are blocked", () => {
  const nanResult = validateMealEditDraft({
    mealName: "מנה",
    mealType: "dinner",
    totalCalories: "NaN",
    ingredients: [{ name: "רכיב", estimatedQuantity: "100 גרם" }],
  });

  const infResult = validateMealEditDraft({
    mealName: "מנה",
    mealType: "dinner",
    totalProteinGrams: "Infinity",
    ingredients: [{ name: "רכיב", estimatedQuantity: "100 גרם" }],
  });

  assert.equal(nanResult.ok, false);
  assert.equal(infResult.ok, false);
});

function toDateSafe(value) {
  if (!value) return null;
  if (value?.toDate && typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isSameDay(dateValue, compareDate) {
  const date = toDateSafe(dateValue);
  if (!date) return false;
  return (
    date.getDate() === compareDate.getDate() &&
    date.getMonth() === compareDate.getMonth() &&
    date.getFullYear() === compareDate.getFullYear()
  );
}

test("local update keeps edited meal in filtered date/category list", () => {
  const selectedDate = new Date("2026-07-15T12:00:00.000Z");
  const entries = [
    {
      id: "meal-1",
      mealType: "lunch",
      mealName: "לפני עריכה",
      createdAt: "2026-07-15T09:15:00.000Z",
      imageUrl: "/uploads/meal-1.jpg",
      source: "app",
    },
    {
      id: "meal-2",
      mealType: "dinner",
      mealName: "ארוחה אחרת",
      createdAt: "2026-07-15T19:00:00.000Z",
    },
  ];

  const next = applyMealUpdateLocally(entries, "meal-1", {
    mealName: "אחרי עריכה",
    totalCalories: 1000,
    createdAt: {},
  });

  const filtered = next.filter((item) => item.mealType === "lunch" && isSameDay(item.createdAt, selectedDate));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "meal-1");
  assert.equal(filtered[0].mealName, "אחרי עריכה");
});

test("only matching meal is updated and unrelated meals stay unchanged", () => {
  const entries = [
    { id: "meal-1", mealType: "lunch", mealName: "ראשונה", createdAt: "2026-07-15T08:00:00.000Z" },
    { id: "meal-2", mealType: "dinner", mealName: "שנייה", createdAt: "2026-07-15T19:00:00.000Z" },
  ];

  const next = applyMealUpdateLocally(entries, "meal-1", { mealName: "עודכנה" });
  assert.equal(next.length, 2);
  assert.equal(next[0].mealName, "עודכנה");
  assert.equal(next[1].mealName, "שנייה");
});

test("partial server response cannot erase core required fields", () => {
  const entries = [
    {
      id: "meal-1",
      mealId: "meal-1",
      mealType: "lunch",
      createdAt: "2026-07-15T08:00:00.000Z",
      imageUrl: "/uploads/meal-1.jpg",
      source: "app",
      phone: "972501234567",
    },
  ];

  const next = applyMealUpdateLocally(entries, "meal-1", {
    mealName: "עודכן",
    createdAt: null,
    mealType: "",
    imageUrl: "",
  });

  assert.equal(next[0].id, "meal-1");
  assert.equal(next[0].mealId, "meal-1");
  assert.equal(next[0].mealType, "lunch");
  assert.equal(next[0].createdAt, "2026-07-15T08:00:00.000Z");
  assert.equal(next[0].imageUrl, "/uploads/meal-1.jpg");
  assert.equal(next[0].source, "app");
  assert.equal(next[0].phone, "972501234567");
});

test("local update does not create duplicate meals", () => {
  const entries = [
    { id: "meal-1", mealName: "מקורית", mealType: "lunch", createdAt: "2026-07-15T08:00:00.000Z" },
  ];

  const next = applyMealUpdateLocally(entries, "meal-1", { mealName: "מעודכנת" });
  assert.equal(next.length, 1);
  assert.equal(next[0].mealName, "מעודכנת");
});
