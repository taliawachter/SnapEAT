import type {
  AnalyzeMealResponse,
  IngredientAnalysis,
  SaveDiaryMealPayload,
} from "../types/mealAnalysis.js";

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || "http://localhost:3000");

function normalizeIngredient(item: any): IngredientAnalysis {
  return {
    name: String(item?.name || "רכיב לא ידוע"),
    calories: Number(item?.calories || 0),
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

  return {
    imageUrl: String(payload?.imageUrl || ""),
    analysis: {
      mealName: String(payload?.analysis?.mealName || "ארוחה חדשה"),
      ingredients: Array.isArray(payload?.analysis?.ingredients)
        ? payload.analysis.ingredients.map((item: any) => normalizeIngredient(item))
        : [],
      totalCalories: Number(payload?.analysis?.totalCalories || 0),
      protein: payload?.analysis?.protein != null ? Number(payload.analysis.protein) : undefined,
      carbs: payload?.analysis?.carbs != null ? Number(payload.analysis.carbs) : undefined,
      fat: payload?.analysis?.fat != null ? Number(payload.analysis.fat) : undefined,
    },
  };
}

export async function saveAnalyzedMealToDiary(payload: SaveDiaryMealPayload) {
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
