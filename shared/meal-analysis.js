const UNKNOWN_QUANTITY_TEXT = "כמות משוערת לא ידועה";
const UNKNOWN_ESTIMATE_TEXT = "לא ניתן להעריך מהתמונה";
const CALORIE_MISMATCH_TOLERANCE_ABSOLUTE = 80;
const CALORIE_MISMATCH_TOLERANCE_RATIO = 0.25;
const MAX_INGREDIENTS = 20;
const MAX_NOTES = 10;

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function roundToOneDecimal(value) {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 10) / 10;
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTextKey(value = "") {
  return normalizeText(value).toLowerCase();
}

function parseNumericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value < 0 ? 0 : value;
  }

  const text = normalizeText(value);
  if (!text) return null;
  if (text.includes("לא זמין") || text.includes("לא ידוע")) return null;

  const normalized = text.replace(/,(?=\d)/g, ".");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;
  return parsed < 0 ? 0 : parsed;
}

function uniqueNotes(values = []) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const note = normalizeText(value);
    if (!note) continue;
    const key = normalizeTextKey(note);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(note);
    if (result.length >= MAX_NOTES) break;
  }
  return result;
}

function parseEstimatedQuantityText(item = {}) {
  const candidate =
    normalizeText(item?.estimatedQuantity) ||
    normalizeText(item?.quantity) ||
    normalizeText(item?.amount);

  if (candidate) return candidate;

  const grams = parseNumericValue(item?.estimatedQuantityGrams ?? item?.grams);
  if (grams !== null) return `${roundToOneDecimal(grams)} גרם`;

  return null;
}

function parseEstimatedQuantityGrams(item = {}) {
  const direct = parseNumericValue(item?.estimatedQuantityGrams ?? item?.grams);
  if (direct !== null) return roundToOneDecimal(direct);

  const quantityText = parseEstimatedQuantityText(item);
  if (!quantityText) return null;
  const gramsMatch = quantityText.replace(/,(?=\d)/g, ".").match(/(\d+(?:\.\d+)?)\s*גרם/);
  if (!gramsMatch?.[1]) return null;
  return roundToOneDecimal(Number(gramsMatch[1]));
}

function normalizeIngredient(raw = {}) {
  const name =
    normalizeText(raw?.name) ||
    normalizeText(raw?.foodName) ||
    normalizeText(raw?.ingredientName) ||
    "רכיב";

  return {
    name,
    estimatedQuantity: parseEstimatedQuantityText(raw),
    estimatedQuantityGrams: parseEstimatedQuantityGrams(raw),
    calories: parseNumericValue(raw?.calories ?? raw?.kcal),
    proteinGrams: parseNumericValue(raw?.protein ?? raw?.proteinGrams),
    carbohydratesGrams: parseNumericValue(raw?.carbs ?? raw?.carbohydrates ?? raw?.carbohydratesGrams),
    fatGrams: parseNumericValue(raw?.fat ?? raw?.fats ?? raw?.fatGrams),
    confidence: roundToOneDecimal(clampNumber(raw?.confidence ?? 0.7, 0, 1)),
  };
}

function sumKnownNumbers(values = []) {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }
  return { sum: roundToOneDecimal(sum), count };
}

function shouldRepairAnalysis(analysis) {
  if (!analysis.ingredients.length) return false;

  const ingredientMissingNutrition = analysis.ingredients.some((ingredient) => (
    ingredient.calories === null ||
    ingredient.proteinGrams === null ||
    ingredient.carbohydratesGrams === null ||
    ingredient.fatGrams === null
  ));
  const missingTotals = [
    analysis.totalCalories,
    analysis.totalProteinGrams,
    analysis.totalCarbohydratesGrams,
    analysis.totalFatGrams,
  ].some((value) => value === null || value === undefined || value <= 0);

  return ingredientMissingNutrition || missingTotals;
}

function withCalculatedTotals(baseAnalysis) {
  const analysis = {
    ...baseAnalysis,
    estimationNotes: uniqueNotes(baseAnalysis.estimationNotes),
    ingredients: Array.isArray(baseAnalysis.ingredients) ? baseAnalysis.ingredients.slice(0, MAX_INGREDIENTS) : [],
  };

  const quantityTotals = sumKnownNumbers(analysis.ingredients.map((item) => item.estimatedQuantityGrams));
  const calorieTotals = sumKnownNumbers(analysis.ingredients.map((item) => item.calories));
  const proteinTotals = sumKnownNumbers(analysis.ingredients.map((item) => item.proteinGrams));
  const carbTotals = sumKnownNumbers(analysis.ingredients.map((item) => item.carbohydratesGrams));
  const fatTotals = sumKnownNumbers(analysis.ingredients.map((item) => item.fatGrams));

  if (analysis.totalEstimatedQuantityGrams === null && quantityTotals.count > 0) {
    analysis.totalEstimatedQuantityGrams = quantityTotals.sum;
  }
  if ((analysis.totalCalories === null || analysis.totalCalories <= 0) && calorieTotals.count > 0) {
    analysis.totalCalories = calorieTotals.sum;
    analysis.estimationNotes.push("סה״כ קלוריות חושב מסכימת הרכיבים.");
  }
  if ((analysis.totalProteinGrams === null || analysis.totalProteinGrams <= 0) && proteinTotals.count > 0) {
    analysis.totalProteinGrams = proteinTotals.sum;
  }
  if ((analysis.totalCarbohydratesGrams === null || analysis.totalCarbohydratesGrams <= 0) && carbTotals.count > 0) {
    analysis.totalCarbohydratesGrams = carbTotals.sum;
  }
  if ((analysis.totalFatGrams === null || analysis.totalFatGrams <= 0) && fatTotals.count > 0) {
    analysis.totalFatGrams = fatTotals.sum;
  }

  const macroCalories = sumKnownNumbers([
    typeof analysis.totalProteinGrams === "number" ? analysis.totalProteinGrams * 4 : null,
    typeof analysis.totalCarbohydratesGrams === "number" ? analysis.totalCarbohydratesGrams * 4 : null,
    typeof analysis.totalFatGrams === "number" ? analysis.totalFatGrams * 9 : null,
  ]);

  if (analysis.totalCalories !== null && macroCalories.count === 3) {
    const tolerance = Math.max(
      CALORIE_MISMATCH_TOLERANCE_ABSOLUTE,
      (analysis.totalCalories || 0) * CALORIE_MISMATCH_TOLERANCE_RATIO,
    );
    if (Math.abs(macroCalories.sum - analysis.totalCalories) > tolerance) {
      analysis.totalCalories = macroCalories.sum;
      analysis.estimationNotes.push("סה״כ הקלוריות תוקן לפי חישוב המאקרו עקב פער משמעותי בהערכה.");
    }
  }

  analysis.estimationNotes = uniqueNotes(analysis.estimationNotes);
  return analysis;
}

export function normalizeMealAnalysis(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      mealName: "ארוחה לא מזוהה",
      description: "",
      totalEstimatedQuantityGrams: null,
      totalCalories: 0,
      totalProteinGrams: 0,
      totalCarbohydratesGrams: 0,
      totalFatGrams: 0,
      confidence: 0,
      estimationNotes: [UNKNOWN_ESTIMATE_TEXT],
      ingredients: [],
    };
  }

  const normalized = {
    mealName:
      normalizeText(raw?.mealName) ||
      normalizeText(raw?.mealTitle) ||
      normalizeText(raw?.title) ||
      "ארוחה לא מזוהה",
    description:
      normalizeText(raw?.description) ||
      normalizeText(raw?.summary) ||
      "",
    totalEstimatedQuantityGrams: parseNumericValue(raw?.totalEstimatedQuantityGrams),
    totalCalories: parseNumericValue(raw?.totalCalories),
    totalProteinGrams: parseNumericValue(raw?.totalProteinGrams ?? raw?.protein),
    totalCarbohydratesGrams: parseNumericValue(raw?.totalCarbohydratesGrams ?? raw?.carbs ?? raw?.carbohydrates),
    totalFatGrams: parseNumericValue(raw?.totalFatGrams ?? raw?.fat),
    confidence: roundToOneDecimal(clampNumber(raw?.confidence ?? 0, 0, 1)),
    estimationNotes: uniqueNotes(raw?.estimationNotes ?? raw?.notes ?? []),
    ingredients: Array.isArray(raw?.ingredients)
      ? raw.ingredients.slice(0, MAX_INGREDIENTS).map((item) => normalizeIngredient(item))
      : [],
  };

  const finalized = withCalculatedTotals(normalized);

  if (!finalized.ingredients.length && !finalized.totalCalories) {
    finalized.estimationNotes = uniqueNotes([
      ...finalized.estimationNotes,
      UNKNOWN_ESTIMATE_TEXT,
    ]);
  }

  return {
    ...finalized,
    totalCalories: finalized.totalCalories ?? 0,
    totalProteinGrams: finalized.totalProteinGrams ?? 0,
    totalCarbohydratesGrams: finalized.totalCarbohydratesGrams ?? 0,
    totalFatGrams: finalized.totalFatGrams ?? 0,
  };
}

export function mergeMissingMealAnalysisFields(baseAnalysis, repairAnalysis) {
  const base = normalizeMealAnalysis(baseAnalysis);
  const repair = normalizeMealAnalysis(repairAnalysis);

  const mergedIngredients = base.ingredients.map((ingredient, index) => {
    const repaired = repair.ingredients[index] || {};
    return {
      ...ingredient,
      estimatedQuantity: ingredient.estimatedQuantity || repaired.estimatedQuantity || null,
      estimatedQuantityGrams: ingredient.estimatedQuantityGrams ?? repaired.estimatedQuantityGrams ?? null,
      calories: ingredient.calories ?? repaired.calories ?? null,
      proteinGrams: ingredient.proteinGrams ?? repaired.proteinGrams ?? null,
      carbohydratesGrams: ingredient.carbohydratesGrams ?? repaired.carbohydratesGrams ?? null,
      fatGrams: ingredient.fatGrams ?? repaired.fatGrams ?? null,
      confidence: Math.max(ingredient.confidence ?? 0, repaired.confidence ?? 0),
    };
  });

  return withCalculatedTotals({
    ...base,
    description: base.description || repair.description,
    totalEstimatedQuantityGrams: base.totalEstimatedQuantityGrams ?? repair.totalEstimatedQuantityGrams ?? null,
    totalCalories: base.totalCalories || repair.totalCalories,
    totalProteinGrams: base.totalProteinGrams || repair.totalProteinGrams,
    totalCarbohydratesGrams: base.totalCarbohydratesGrams || repair.totalCarbohydratesGrams,
    totalFatGrams: base.totalFatGrams || repair.totalFatGrams,
    confidence: Math.max(base.confidence ?? 0, repair.confidence ?? 0),
    estimationNotes: uniqueNotes([...base.estimationNotes, ...repair.estimationNotes]),
    ingredients: mergedIngredients,
  });
}

export function mealAnalysisNeedsClarification(analysis) {
  const normalized = normalizeMealAnalysis(analysis);
  const unknownQuantityCount = normalized.ingredients.filter((item) => !item.estimatedQuantity && item.estimatedQuantityGrams == null).length;
  const unknownNutritionCount = normalized.ingredients.filter((item) => (
    item.calories == null ||
    item.proteinGrams == null ||
    item.carbohydratesGrams == null ||
    item.fatGrams == null
  )).length;

  return normalized.confidence < 0.55 ||
    normalized.totalCalories <= 0 ||
    unknownQuantityCount > Math.max(1, Math.floor(normalized.ingredients.length / 2)) ||
    unknownNutritionCount > Math.max(1, Math.floor(normalized.ingredients.length / 2));
}

export function mealAnalysisNeedsRepair(analysis) {
  return shouldRepairAnalysis(normalizeMealAnalysis(analysis));
}

export function canonicalAnalysisToLegacyText(analysisInput) {
  const analysis = normalizeMealAnalysis(analysisInput);
  const ingredientLines = analysis.ingredients.map((ingredient) => {
    const quantity = ingredient.estimatedQuantity || (ingredient.estimatedQuantityGrams != null
      ? `${ingredient.estimatedQuantityGrams} גרם`
      : UNKNOWN_QUANTITY_TEXT);
    const carbs = ingredient.carbohydratesGrams != null ? `${ingredient.carbohydratesGrams} גרם` : UNKNOWN_ESTIMATE_TEXT;
    const fat = ingredient.fatGrams != null ? `${ingredient.fatGrams} גרם` : UNKNOWN_ESTIMATE_TEXT;
    const protein = ingredient.proteinGrams != null ? `${ingredient.proteinGrams} גרם` : UNKNOWN_ESTIMATE_TEXT;
    const calories = ingredient.calories != null ? `${ingredient.calories} קל׳` : UNKNOWN_ESTIMATE_TEXT;

    return `${ingredient.name} | כמות: ${quantity} | פחמימות: ${carbs} | שומנים: ${fat} | חלבונים: ${protein} | קלוריות: ${calories}`;
  });

  const lines = [
    `זיהיתי: ${analysis.mealName}`,
  ];

  if (analysis.description) {
    lines.push(analysis.description);
  }

  lines.push("", "רכיבים מפורטים:", ...ingredientLines, "", "קלוריות משוערות:", `הערכה סבירה: ${analysis.totalCalories}`, "", "מאקרו משוער:", `חלבון: ${analysis.totalProteinGrams}`, `פחמימות: ${analysis.totalCarbohydratesGrams}`, `שומן: ${analysis.totalFatGrams}`, `סה״כ: ${analysis.totalCalories} קל׳`);

  if (analysis.estimationNotes.length) {
    lines.push("", "הערות:", ...analysis.estimationNotes.map((note) => `- ${note}`));
  }

  return lines.join("\n");
}

function parseLegacyAnalysisText(text = "") {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const ingredientLines = lines.filter((line) => line.includes("|") && (line.includes("קלור") || line.includes("חלבונ") || line.includes("פחמימ")));

  const ingredients = ingredientLines.map((line) => {
    const parts = line.split("|").map((part) => part.trim());
    return normalizeIngredient({
      name: parts[0],
      quantity: parts.find((part) => part.includes("כמות"))?.replace(/^כמות:\s*/, ""),
      carbs: parts.find((part) => part.includes("פחמימות")),
      fat: parts.find((part) => part.includes("שומנים") || part.includes("שומן")),
      protein: parts.find((part) => part.includes("חלבונים") || part.includes("חלבון")),
      calories: parts.find((part) => part.includes("קלוריות") || part.includes("קל׳")),
    });
  });

  const totalCalories = parseNumericValue(lines.find((line) => line.startsWith("הערכה סבירה:")));
  const totalProteinGrams = parseNumericValue(lines.find((line) => line.startsWith("חלבון:")));
  const totalCarbohydratesGrams = parseNumericValue(lines.find((line) => line.startsWith("פחמימות:")));
  const totalFatGrams = parseNumericValue(lines.find((line) => line.startsWith("שומן:")));
  const mealName = normalizeText(lines.find((line) => line.startsWith("זיהיתי:"))?.replace(/^זיהיתי:\s*/, "")) || "ארוחה לא מזוהה";

  return normalizeMealAnalysis({
    mealName,
    ingredients,
    totalCalories,
    totalProteinGrams,
    totalCarbohydratesGrams,
    totalFatGrams,
  });
}

export function normalizeMealRecordForDisplay(meal = {}) {
  const structured = meal?.analysis && typeof meal.analysis === "object"
    ? meal.analysis
    : {
        mealName: meal?.mealName,
        ingredients: meal?.ingredients,
        totalCalories: meal?.totalCalories,
        protein: meal?.protein,
        carbs: meal?.carbs,
        fat: meal?.fat,
      };

  const normalized = normalizeMealAnalysis(structured);

  if ((!normalized.ingredients.length || normalized.totalCalories <= 0) && normalizeText(meal?.analysisText)) {
    const legacy = parseLegacyAnalysisText(meal.analysisText);
    return normalizeMealAnalysis({
      ...normalized,
      mealName: normalized.mealName || legacy.mealName,
      ingredients: normalized.ingredients.length ? normalized.ingredients : legacy.ingredients,
      totalCalories: normalized.totalCalories || legacy.totalCalories,
      totalProteinGrams: normalized.totalProteinGrams || legacy.totalProteinGrams,
      totalCarbohydratesGrams: normalized.totalCarbohydratesGrams || legacy.totalCarbohydratesGrams,
      totalFatGrams: normalized.totalFatGrams || legacy.totalFatGrams,
      estimationNotes: uniqueNotes([...normalized.estimationNotes, ...legacy.estimationNotes]),
    });
  }

  return normalized;
}

export function formatEstimatedQuantityDisplay(ingredient = {}) {
  return normalizeText(ingredient?.estimatedQuantity) ||
    (ingredient?.estimatedQuantityGrams != null ? `${ingredient.estimatedQuantityGrams} גרם` : UNKNOWN_QUANTITY_TEXT);
}

export function formatEstimatedNumericDisplay(value, suffix = "") {
  const numeric = parseNumericValue(value);
  return numeric !== null ? `${numeric}${suffix}` : UNKNOWN_ESTIMATE_TEXT;
}

export {
  UNKNOWN_ESTIMATE_TEXT,
  UNKNOWN_QUANTITY_TEXT,
};
