import { normalizeMealRecordForDisplay } from "./meal-analysis.js";

const FORBIDDEN_NUMERIC_TEXT = ["לא זמין", "לא ידוע"];
const CALORIE_MISMATCH_TOLERANCE_ABSOLUTE = 80;
const CALORIE_MISMATCH_TOLERANCE_RATIO = 0.1;

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseOptionalNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return { value: null, error: null };

  const text = cleanText(value);
  if (!text) return { value: null, error: null };

  if (FORBIDDEN_NUMERIC_TEXT.some((word) => text.includes(word))) {
    return { value: null, error: "אין להשתמש בערכי טקסט כמו לא זמין בשדה מספרי." };
  }

  const parsed = Number(text.replace(/,(?=\d)/g, "."));
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return { value: null, error: "הערך חייב להיות מספר תקין." };
  }

  if (parsed < 0) {
    return { value: null, error: "הערך חייב להיות מספר לא שלילי." };
  }

  return { value: Math.round(parsed * 10) / 10, error: null };
}

function parseIngredientQuantityText(value) {
  const text = cleanText(value);
  if (!text) return { value: null, error: null };

  const negativeNumeric = text.match(/-\d+(?:\.\d+)?/);
  if (negativeNumeric) {
    return { value: null, error: "כמות מרכיב לא יכולה להיות שלילית." };
  }

  return { value: text, error: null };
}

function normalizeIngredientDraft(raw = {}) {
  return {
    name: cleanText(raw.name || "רכיב"),
    estimatedQuantity: cleanText(raw.estimatedQuantity),
    calories: raw.calories ?? null,
    proteinGrams: raw.proteinGrams ?? null,
    carbohydratesGrams: raw.carbohydratesGrams ?? null,
    fatGrams: raw.fatGrams ?? null,
  };
}

function extractLegacyMealName(analysisText) {
  const text = String(analysisText || "");
  const match = text.match(/זיהיתי:\s*([^\n]+)/);
  if (!match?.[1]) return "";
  return cleanText(match[1]);
}

function toRounded(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

export function normalizeMealForEdit(meal = {}, fallbackMealName = "ארוחה", fallbackMealType = "lunch") {
  const normalized = normalizeMealRecordForDisplay(meal);
  const legacyMealName = extractLegacyMealName(meal?.analysisText);
  const normalizedMealName = cleanText(normalized.mealName || "");
  const shouldUseLegacyName = normalizedMealName === "ארוחה לא מזוהה" && legacyMealName;

  return {
    mealName: cleanText((shouldUseLegacyName ? legacyMealName : normalized.mealName) || meal.mealName || fallbackMealName),
    mealType: cleanText(meal.mealType || fallbackMealType) || fallbackMealType,
    totalEstimatedQuantityGrams: normalized.totalEstimatedQuantityGrams ?? null,
    totalCalories: normalized.totalCalories ?? null,
    totalProteinGrams: normalized.totalProteinGrams ?? null,
    totalCarbohydratesGrams: normalized.totalCarbohydratesGrams ?? null,
    totalFatGrams: normalized.totalFatGrams ?? null,
    ingredients: (normalized.ingredients || []).map((ingredient) => normalizeIngredientDraft(ingredient)),
  };
}

export function calculateCaloriesFromMacros({ proteinGrams, carbohydratesGrams, fatGrams }) {
  if (
    !Number.isFinite(proteinGrams) ||
    !Number.isFinite(carbohydratesGrams) ||
    !Number.isFinite(fatGrams)
  ) {
    return null;
  }

  return toRounded((proteinGrams * 4) + (carbohydratesGrams * 4) + (fatGrams * 9));
}

export function recalculateTotalsFromIngredients(ingredients = []) {
  const totals = {
    totalCalories: 0,
    totalProteinGrams: 0,
    totalCarbohydratesGrams: 0,
    totalFatGrams: 0,
    hasAny: false,
  };

  for (const ingredient of ingredients) {
    if (Number.isFinite(ingredient.calories)) {
      totals.totalCalories += Number(ingredient.calories);
      totals.hasAny = true;
    }
    if (Number.isFinite(ingredient.proteinGrams)) {
      totals.totalProteinGrams += Number(ingredient.proteinGrams);
      totals.hasAny = true;
    }
    if (Number.isFinite(ingredient.carbohydratesGrams)) {
      totals.totalCarbohydratesGrams += Number(ingredient.carbohydratesGrams);
      totals.hasAny = true;
    }
    if (Number.isFinite(ingredient.fatGrams)) {
      totals.totalFatGrams += Number(ingredient.fatGrams);
      totals.hasAny = true;
    }
  }

  return {
    totalCalories: toRounded(totals.totalCalories),
    totalProteinGrams: toRounded(totals.totalProteinGrams),
    totalCarbohydratesGrams: toRounded(totals.totalCarbohydratesGrams),
    totalFatGrams: toRounded(totals.totalFatGrams),
    hasAny: totals.hasAny,
  };
}

export function getMacroMismatchWarning(draft) {
  const macroCalories = calculateCaloriesFromMacros({
    proteinGrams: draft?.totalProteinGrams,
    carbohydratesGrams: draft?.totalCarbohydratesGrams,
    fatGrams: draft?.totalFatGrams,
  });
  if (macroCalories === null || !Number.isFinite(draft.totalCalories)) return null;

  const tolerance = Math.max(
    CALORIE_MISMATCH_TOLERANCE_ABSOLUTE,
    Number(draft.totalCalories || 0) * CALORIE_MISMATCH_TOLERANCE_RATIO,
  );

  if (Math.abs(macroCalories - Number(draft.totalCalories)) <= tolerance) {
    return null;
  }

  return `אזהרה: יש פער משמעותי בין הקלוריות (${draft.totalCalories}) לחישוב המאקרו (${macroCalories}).`;
}

export function validateMealEditDraft(rawDraft) {
  const draft = {
    mealName: cleanText(rawDraft?.mealName),
    mealType: cleanText(rawDraft?.mealType),
    totalEstimatedQuantityGrams: null,
    totalCalories: null,
    totalProteinGrams: null,
    totalCarbohydratesGrams: null,
    totalFatGrams: null,
    ingredients: [],
  };

  const errors = [];

  if (!draft.mealName) {
    errors.push("שם הארוחה הוא שדה חובה.");
  }

  const mealType = draft.mealType || "lunch";
  if (!["breakfast", "lunch", "dinner", "snack"].includes(mealType)) {
    errors.push("סוג הארוחה לא תקין.");
  }
  draft.mealType = mealType;

  const totalEstimatedQuantity = parseOptionalNonNegativeNumber(rawDraft?.totalEstimatedQuantityGrams);
  if (totalEstimatedQuantity.error) errors.push(`כמות כוללת: ${totalEstimatedQuantity.error}`);
  draft.totalEstimatedQuantityGrams = totalEstimatedQuantity.value;

  const totalCalories = parseOptionalNonNegativeNumber(rawDraft?.totalCalories);
  if (totalCalories.error) errors.push(`קלוריות: ${totalCalories.error}`);
  draft.totalCalories = totalCalories.value;

  const totalProtein = parseOptionalNonNegativeNumber(rawDraft?.totalProteinGrams);
  if (totalProtein.error) errors.push(`חלבון: ${totalProtein.error}`);
  draft.totalProteinGrams = totalProtein.value;

  const totalCarbs = parseOptionalNonNegativeNumber(rawDraft?.totalCarbohydratesGrams);
  if (totalCarbs.error) errors.push(`פחמימות: ${totalCarbs.error}`);
  draft.totalCarbohydratesGrams = totalCarbs.value;

  const totalFat = parseOptionalNonNegativeNumber(rawDraft?.totalFatGrams);
  if (totalFat.error) errors.push(`שומן: ${totalFat.error}`);
  draft.totalFatGrams = totalFat.value;

  const ingredients = Array.isArray(rawDraft?.ingredients) ? rawDraft.ingredients : [];

  draft.ingredients = ingredients
    .map((rawIngredient, index) => {
      const ingredientName = cleanText(rawIngredient?.name || "");
      const ingredientLabel = `מרכיב ${index + 1}`;

      if (!ingredientName) {
        errors.push(`${ingredientLabel}: יש להזין שם מרכיב.`);
      }

      const quantityText = parseIngredientQuantityText(rawIngredient?.estimatedQuantity);
      if (quantityText.error) {
        errors.push(`${ingredientLabel}: ${quantityText.error}`);
      }

      const calories = parseOptionalNonNegativeNumber(rawIngredient?.calories);
      if (calories.error) errors.push(`${ingredientLabel} קלוריות: ${calories.error}`);

      const protein = parseOptionalNonNegativeNumber(rawIngredient?.proteinGrams);
      if (protein.error) errors.push(`${ingredientLabel} חלבון: ${protein.error}`);

      const carbohydrates = parseOptionalNonNegativeNumber(rawIngredient?.carbohydratesGrams);
      if (carbohydrates.error) errors.push(`${ingredientLabel} פחמימות: ${carbohydrates.error}`);

      const fat = parseOptionalNonNegativeNumber(rawIngredient?.fatGrams);
      if (fat.error) errors.push(`${ingredientLabel} שומן: ${fat.error}`);

      const hasValues = ingredientName || quantityText.value || calories.value != null || protein.value != null || carbohydrates.value != null || fat.value != null;
      if (!hasValues) return null;

      return {
        name: ingredientName || "רכיב",
        estimatedQuantity: quantityText.value,
        calories: calories.value,
        proteinGrams: protein.value,
        carbohydratesGrams: carbohydrates.value,
        fatGrams: fat.value,
      };
    })
    .filter(Boolean);

  return {
    ok: errors.length === 0,
    errors,
    draft,
    mismatchWarning: getMacroMismatchWarning(draft),
  };
}

export function buildCanonicalMealUpdatePayload(validDraft) {
  const ingredients = (validDraft.ingredients || []).map((ingredient) => {
    const quantity = cleanText(ingredient.estimatedQuantity);
    const gramsMatch = quantity.match(/(\d+(?:\.\d+)?)\s*גרם/);
    const estimatedQuantityGrams = gramsMatch?.[1] ? Number(gramsMatch[1]) : null;

    return {
      name: cleanText(ingredient.name) || "רכיב",
      estimatedQuantity: quantity || null,
      estimatedQuantityGrams: Number.isFinite(estimatedQuantityGrams) ? toRounded(estimatedQuantityGrams) : null,
      calories: ingredient.calories ?? null,
      proteinGrams: ingredient.proteinGrams ?? null,
      carbohydratesGrams: ingredient.carbohydratesGrams ?? null,
      fatGrams: ingredient.fatGrams ?? null,
      quantity: quantity || null,
      grams: Number.isFinite(estimatedQuantityGrams) ? toRounded(estimatedQuantityGrams) : null,
      protein: ingredient.proteinGrams ?? null,
      carbs: ingredient.carbohydratesGrams ?? null,
      fat: ingredient.fatGrams ?? null,
    };
  });

  return {
    mealName: cleanText(validDraft.mealName),
    mealType: validDraft.mealType,
    totalEstimatedQuantityGrams: validDraft.totalEstimatedQuantityGrams,
    totalCalories: validDraft.totalCalories ?? 0,
    totalProteinGrams: validDraft.totalProteinGrams ?? 0,
    totalCarbohydratesGrams: validDraft.totalCarbohydratesGrams ?? 0,
    totalFatGrams: validDraft.totalFatGrams ?? 0,
    protein: validDraft.totalProteinGrams ?? 0,
    carbs: validDraft.totalCarbohydratesGrams ?? 0,
    fat: validDraft.totalFatGrams ?? 0,
    ingredients,
  };
}

function isDateLike(value) {
  if (!value) return false;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value?.toDate === "function") {
    const dateValue = value.toDate();
    return dateValue instanceof Date && !Number.isNaN(dateValue.getTime());
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
  }

  if (typeof value === "object") {
    const seconds = Number(value?._seconds ?? value?.seconds);
    return Number.isFinite(seconds);
  }

  return false;
}

export function applyMealUpdateLocally(entries = [], mealId, updatedMeal) {
  return entries.map((entry) => {
    if (entry.id !== mealId) return entry;

    const merged = {
      ...entry,
      ...(updatedMeal && typeof updatedMeal === "object" ? updatedMeal : {}),
    };

    merged.id = entry.id || mealId;
    merged.mealId = merged.mealId || entry.mealId || mealId;
    if (!merged.mealType) merged.mealType = entry.mealType;
    if (!isDateLike(merged.createdAt)) merged.createdAt = entry.createdAt;
    if (!merged.imageUrl && entry.imageUrl) merged.imageUrl = entry.imageUrl;
    if (!merged.source && entry.source) merged.source = entry.source;
    if (!merged.phone && entry.phone) merged.phone = entry.phone;
    if (!merged.userId && entry.userId) merged.userId = entry.userId;

    return merged;
  });
}

export function extractBearerToken(authorizationHeader = "") {
  const raw = String(authorizationHeader || "").trim();
  if (!raw.toLowerCase().startsWith("bearer ")) return null;
  const token = raw.slice(7).trim();
  return token || null;
}

export function openMealEditState(mealId, draft) {
  return {
    isOpen: true,
    mealId,
    draft: JSON.parse(JSON.stringify(draft || {})),
    originalDraft: JSON.parse(JSON.stringify(draft || {})),
  };
}

export function cancelMealEditState(state) {
  return {
    isOpen: false,
    mealId: null,
    draft: state?.originalDraft ? JSON.parse(JSON.stringify(state.originalDraft)) : null,
    originalDraft: null,
  };
}
