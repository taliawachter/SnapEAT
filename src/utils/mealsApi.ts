import type {
  AnalyzeMealResponse,
  SaveDiaryMealPayload,
} from "../types/mealAnalysis.js";
import { auth } from "../firebase.js";
import { normalizeMealAnalysis } from "../../shared/meal-analysis.js";

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || "http://localhost:3000");
const DEBUG_MEAL_ANALYSIS = import.meta.env.VITE_DEBUG_MEAL_ANALYSIS === "true";

type ApiRequestError = Error & {
  status?: number;
  code?: string;
};

function buildApiRequestError(message: string, status?: number, code?: string): ApiRequestError {
  const error = new Error(message) as ApiRequestError;
  if (status != null) error.status = status;
  if (code) error.code = code;
  return error;
}

async function parseErrorPayload(response: Response): Promise<{ message: string; code: string }> {
  const fallbackCode = `HTTP_${response.status}`;
  const fallbackMessage = "עדכון הארוחה נכשל.";

  try {
    const payload = await response.json();
    const message = String(payload?.error || payload?.message || fallbackMessage).trim() || fallbackMessage;
    const code = String(payload?.code || fallbackCode).trim() || fallbackCode;
    return { message, code };
  } catch {
    const text = (await response.text()).trim();
    return {
      message: text || fallbackMessage,
      code: fallbackCode,
    };
  }
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
    analysis: normalizeMealAnalysis(payload?.analysis || {}),
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

export async function updateDiaryMeal(mealId: string, payload: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("צריך להתחבר כדי לערוך ארוחה.");
  }

  const idToken = await user.getIdToken();
  const response = await fetch(`${API_BASE_URL}/api/diary/meals/${encodeURIComponent(mealId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = await parseErrorPayload(response);
    throw buildApiRequestError(errorPayload.message, response.status, errorPayload.code);
  }

  return response.json();
}

export async function deleteDiaryMeal(mealId: string) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("צריך להתחבר כדי למחוק ארוחה.");
  }

  const idToken = await user.getIdToken();
  const response = await fetch(`${API_BASE_URL}/api/diary/meals/${encodeURIComponent(mealId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    const errorPayload = await parseErrorPayload(response);
    throw buildApiRequestError(errorPayload.message, response.status, errorPayload.code);
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
