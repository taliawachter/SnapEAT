import type {
  AnalyzeMealResponse,
  IngredientAnalysis,
  SaveDiaryMealPayload,
} from "../types/mealAnalysis.js";

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || "http://localhost:3000");
const DEBUG_MEAL_ANALYSIS = import.meta.env.VITE_DEBUG_MEAL_ANALYSIS === "true";

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toQuantityText(item: any): string | undefined {
  if (typeof item?.quantity === "string" && item.quantity.trim()) {
    return item.quantity.trim();
  }

  if (typeof item?.amount === "string" && item.amount.trim()) {
    return item.amount.trim();
  }

  const grams = toOptionalNumber(item?.grams);
  if (grams !== undefined) {
    return `${grams} גרם`;
  }

  return undefined;
}

function normalizeIngredient(item: any): IngredientAnalysis {
  const calories =
    toOptionalNumber(item?.calories) ??
    toOptionalNumber(item?.kcal) ??
    0;

  const protein = toOptionalNumber(item?.protein);
  const carbs =
    toOptionalNumber(item?.carbs) ??
    toOptionalNumber(item?.carbohydrates);
  const fat =
    toOptionalNumber(item?.fat) ??
    toOptionalNumber(item?.fats);

  return {
    name: String(item?.name || item?.foodName || item?.ingredientName || "רכיב לא ידוע"),
    calories,
    ...(toQuantityText(item) ? { quantity: String(toQuantityText(item)) } : {}),
    ...(protein != null ? { protein } : {}),
    ...(carbs != null ? { carbs } : {}),
    ...(fat != null ? { fat } : {}),
  };
}

export async function analyzeMealPhoto(file: File): Promise<AnalyzeMealResponse> {
  const formData = new FormData();
  formData.append("mealImage", file);

  const response = await fetch(`${API_BASE_URL}/api/meals/analyze`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Meal analysis request failed");
  }

  const payload = await response.json();

  if (DEBUG_MEAL_ANALYSIS) {
    console.log("[meal-analysis] analyze response payload", payload);
  }

  return {
    imageUrl: String(payload?.imageUrl || ""),
    analysis: {
      mealName: String(payload?.analysis?.mealName || "ארוחה חדשה"),
      ingredients: Array.isArray(payload?.analysis?.ingredients)
        ? payload.analysis.ingredients.map((item: any) => normalizeIngredient(item))
        : [],
      totalCalories: Number(payload?.analysis?.totalCalories || 0),
      ...(payload?.analysis?.protein != null
        ? { protein: Number(payload.analysis.protein) }
        : {}),
      ...(payload?.analysis?.carbs != null
        ? { carbs: Number(payload.analysis.carbs) }
        : {}),
      ...(payload?.analysis?.fat != null
        ? { fat: Number(payload.analysis.fat) }
        : {}),
      ...(payload?.analysis?.confidence != null
        ? { confidence: Number(payload.analysis.confidence) }
        : {}),
    },
  };
}

export async function saveAnalyzedMealToDiary(payload: SaveDiaryMealPayload) {
  if (DEBUG_MEAL_ANALYSIS) {
    console.log("[meal-analysis] save payload", payload);
  }

  const response = await fetch(`${API_BASE_URL}/api/diary/meals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Failed to save analyzed meal");
  }

  return response.json();
}

export function toAbsoluteUploadUrl(imageUrl: string) {
  if (!imageUrl) return "";
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) return imageUrl;

  if (imageUrl.startsWith("/")) {
    return `${API_BASE_URL}${imageUrl}`;
  }

  return `${API_BASE_URL}/${imageUrl}`;
}
