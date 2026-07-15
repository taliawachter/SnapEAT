import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { collection, getDocs, orderBy, query } from "firebase/firestore/lite";
import { onAuthStateChanged } from "firebase/auth";
import type { FirebaseError } from "firebase/app";
import { ChevronRight, Heart, Pencil } from "lucide-react";
import { auth, db } from "../firebase.js";
import { addFavorite, isMealFavorited } from "../utils/favoritesApi.js";
import { updateDiaryMeal } from "../utils/mealsApi.js";
import {
  formatEstimatedNumericDisplay,
  formatEstimatedQuantityDisplay,
  normalizeMealRecordForDisplay,
} from "../../shared/meal-analysis.js";
import {
  applyMealUpdateLocally,
  buildCanonicalMealUpdatePayload,
  getMacroMismatchWarning,
  normalizeMealForEdit,
  recalculateTotalsFromIngredients,
  validateMealEditDraft,
} from "../../shared/meal-edit.js";

const DEBUG_MEAL_ANALYSIS = import.meta.env.VITE_DEBUG_MEAL_ANALYSIS === "true";

type MealType = "breakfast" | "lunch" | "dinner" | "snack";

type MealEntry = {
  id: string;
  mealType?: MealType;
  mealNote?: string;
  mealName?: string;
  totalCalories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  analysisText?: string;
  ingredients?: Array<Record<string, unknown>>;
  analysis?: {
    mealName?: string;
    totalCalories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    ingredients?: Array<Record<string, unknown>>;
  };
  createdAt?: any;
  imageUrl?: string | null;
};

const mealLabels: Record<MealType, string> = {
  breakfast: "בוקר",
  lunch: "צהריים",
  dinner: "ערב",
  snack: "ביניים",
};

const mealIcons: Record<MealType, string> = {
  breakfast: "☕",
  lunch: "🍔",
  dinner: "🥗",
  snack: "🍎",
};

function MealPageHeader({
  title = "הארוחות שלי",
  onBack,
}: {
  title?: string;
  onBack: () => void;
}) {
  return (
    <header className="px-4 pt-10 pb-4">
      <div className="flex items-center justify-between border-b border-[#CFC9C1] pb-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full p-2 text-orange transition hover:bg-orange/10"
          aria-label="חזרה"
        >
          <ChevronRight className="h-7 w-7" />
        </button>

        <h1 className="text-2xl font-bold text-orange">{title}</h1>

        <div className="h-11 w-11" />
      </div>
    </header>
  );
}

function MealSectionBanner({
  icon,
  title,
}: {
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="bg-borange py-3 text-center text-2xl font-bold text-orange">
      <span className="ml-2">{icon}</span>
      {title}
    </div>
  );
}

function AddMealButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-auto mb-8 flex h-12 min-w-60 items-center justify-center rounded-full bg-orange px-8 text-xl font-bold text-white shadow-md"
    >
      + צלם ארוחה
    </button>
  );
}

function MealImage({
  src,
  alt,
}: {
  src?: string | null | undefined;
  alt: string | null;
}) {
  return (
    <div className="mx-auto flex h-100 w-100 items-center justify-center overflow-hidden rounded-3xl border-6 border-white bg-white shadow-sm">
      {src ? (
        <img
          src={src}
          alt={alt ?? ""}
          className="h-100 w-100 bg-bbrown object-cover object-center"
        />
      ) : (
        <div
          className="flex h-100 w-100 items-center justify-center bg-bbrown text-lg text-placeholder"
        >
          אין תמונה זמינה
        </div>
      )}
    </div>
  );
}

function MealCardShell({
  title,
  calories,
  details,
  isFavorited,
  isSavingFavorite,
  onEditClick,
  onFavoriteClick,
  expanded = false,
}: {
  title: string;
  calories: number;
  details: string[];
  isFavorited: boolean;
  isSavingFavorite: boolean;
  onEditClick: () => void;
  onFavoriteClick: () => void;
  expanded?: boolean;
}) {
  return (
    <div className="mt-6 w-full overflow-hidden rounded-3xl border border-brown bg-white text-right shadow-[0_14px_30px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between border-b border-brown px-5 py-4">
        <div className="flex items-center gap-4 text-orange">
           <h2 className="text-xl font-bold text-black">{title}</h2>
          <button
            type="button"
            aria-label="עריכה"
            onClick={(event) => {
              event.stopPropagation();
              onEditClick();
            }}
          >
            <Pencil className="h-8 w-8" />
          </button>
          <button
            type="button"
            aria-label="מועדפים"
            disabled={isSavingFavorite}
            onClick={onFavoriteClick}
          >
            <Heart
              className={`h-8 w-8 transition ${
                isFavorited ? "fill-orange text-orange" : ""
              }`}
            />
          </button>
        </div>

      </div>

      {expanded && (
        <div className="px-6 py-5">
          {details.length > 0 ? (
            <div className="space-y-5">
              {details.map((line, index) => (
                <div
                  key={`${title}-${index}`}
                  className="border-b border-brown pb-4 last:border-b-0 last:pb-0"
                >
<p className="whitespace-pre-line text-right text-xl font-semibold leading-9 text-dark"> {line}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-right text-xl text-dark">
              אין פירוט נוסף לארוחה הזאת
            </p>
          )}
        </div>
      )}

      <div className="bg-borange px-6 py-4 text-left text-3xl font-bold text-orange">
        סה״כ: {calories} קל׳
      </div>
    </div>
  );
}

function toInputNumberValue(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function MealEditModal({
  mealDraft,
  setMealDraft,
  validationErrors,
  saveError,
  isSaving,
  mismatchWarning,
  onRecalculate,
  onCancel,
  onSave,
}: {
  mealDraft: any;
  setMealDraft: (updater: (previous: any) => any) => void;
  validationErrors: string[];
  saveError: string | null;
  isSaving: boolean;
  mismatchWarning: string | null;
  onRecalculate: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-150 rounded-3xl bg-cream p-5 shadow-2xl"
        dir="rtl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-orange">עריכת ארוחה</h2>
        <p className="mt-1 text-sm text-placeholder">עדכני את הפרטים ושמרי</p>

        <div className="mt-4 space-y-3 max-h-[65vh] overflow-y-auto pr-1">
          <input
            type="text"
            value={mealDraft.mealName}
            onChange={(event) => {
              const nextValue = event.target.value;
              setMealDraft((previous) => ({ ...previous, mealName: nextValue }));
            }}
            placeholder="שם הארוחה"
            className="w-full rounded-xl border border-[#DDD4C8] bg-white px-3 py-3 text-right outline-none"
          />

          <select
            value={mealDraft.mealType}
            onChange={(event) => {
              const nextValue = event.target.value;
              setMealDraft((previous) => ({ ...previous, mealType: nextValue }));
            }}
            className="w-full rounded-xl border border-[#DDD4C8] bg-white px-3 py-3 text-right outline-none"
          >
            <option value="breakfast">ארוחת בוקר</option>
            <option value="lunch">ארוחת צהריים</option>
            <option value="dinner">ארוחת ערב</option>
            <option value="snack">ארוחת ביניים</option>
          </select>

          <input
            type="text"
            inputMode="decimal"
            value={toInputNumberValue(mealDraft.totalEstimatedQuantityGrams)}
            onChange={(event) => {
              const nextValue = event.target.value;
              setMealDraft((previous) => ({
                ...previous,
                totalEstimatedQuantityGrams: nextValue,
              }));
            }}
            placeholder="כמות כוללת משוערת (גרם)"
            className="w-full rounded-xl border border-[#DDD4C8] bg-white px-3 py-3 text-right outline-none"
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={toInputNumberValue(mealDraft.totalCalories)}
              onChange={(event) => {
                const nextValue = event.target.value;
                setMealDraft((previous) => ({ ...previous, totalCalories: nextValue }));
              }}
              placeholder="קלוריות"
              className="rounded-xl border border-[#DDD4C8] bg-white px-3 py-3 text-right outline-none"
            />
            <input
              type="text"
              inputMode="decimal"
              value={toInputNumberValue(mealDraft.totalProteinGrams)}
              onChange={(event) => {
                const nextValue = event.target.value;
                setMealDraft((previous) => ({ ...previous, totalProteinGrams: nextValue }));
              }}
              placeholder="חלבון (גרם)"
              className="rounded-xl border border-[#DDD4C8] bg-white px-3 py-3 text-right outline-none"
            />
            <input
              type="text"
              inputMode="decimal"
              value={toInputNumberValue(mealDraft.totalCarbohydratesGrams)}
              onChange={(event) => {
                const nextValue = event.target.value;
                setMealDraft((previous) => ({ ...previous, totalCarbohydratesGrams: nextValue }));
              }}
              placeholder="פחמימות (גרם)"
              className="rounded-xl border border-[#DDD4C8] bg-white px-3 py-3 text-right outline-none"
            />
            <input
              type="text"
              inputMode="decimal"
              value={toInputNumberValue(mealDraft.totalFatGrams)}
              onChange={(event) => {
                const nextValue = event.target.value;
                setMealDraft((previous) => ({ ...previous, totalFatGrams: nextValue }));
              }}
              placeholder="שומן (גרם)"
              className="rounded-xl border border-[#DDD4C8] bg-white px-3 py-3 text-right outline-none"
            />
          </div>

          <div className="rounded-2xl border border-[#DDD4C8] bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-bold text-dark">רכיבים</p>
              <button
                type="button"
                onClick={() => {
                  setMealDraft((previous) => ({
                    ...previous,
                    ingredients: [
                      ...(Array.isArray(previous.ingredients) ? previous.ingredients : []),
                      {
                        name: "",
                        estimatedQuantity: "",
                        calories: "",
                        proteinGrams: "",
                        carbohydratesGrams: "",
                        fatGrams: "",
                      },
                    ],
                  }));
                }}
                className="rounded-full border border-orange px-3 py-1 text-sm font-semibold text-orange"
              >
                + הוסף רכיב
              </button>
            </div>

            <div className="space-y-3">
              {(mealDraft.ingredients || []).map((ingredient: any, ingredientIndex: number) => (
                <div key={`ingredient-${ingredientIndex}`} className="rounded-xl border border-orange/20 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-semibold text-dark">מרכיב {ingredientIndex + 1}</p>
                    <button
                      type="button"
                      className="text-sm font-semibold text-orange"
                      onClick={() => {
                        setMealDraft((previous) => ({
                          ...previous,
                          ingredients: (previous.ingredients || []).filter((_: unknown, index: number) => index !== ingredientIndex),
                        }));
                      }}
                    >
                      הסר
                    </button>
                  </div>

                  <div className="space-y-2">
                    <input
                      type="text"
                      value={ingredient.name || ""}
                      placeholder="שם רכיב"
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setMealDraft((previous) => ({
                          ...previous,
                          ingredients: (previous.ingredients || []).map((current: any, index: number) => (
                            index === ingredientIndex ? { ...current, name: nextValue } : current
                          )),
                        }));
                      }}
                      className="w-full rounded-xl border border-[#DDD4C8] bg-white px-3 py-2 text-right outline-none"
                    />
                    <input
                      type="text"
                      value={ingredient.estimatedQuantity || ""}
                      placeholder="כמות משוערת"
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setMealDraft((previous) => ({
                          ...previous,
                          ingredients: (previous.ingredients || []).map((current: any, index: number) => (
                            index === ingredientIndex ? { ...current, estimatedQuantity: nextValue } : current
                          )),
                        }));
                      }}
                      className="w-full rounded-xl border border-[#DDD4C8] bg-white px-3 py-2 text-right outline-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={toInputNumberValue(ingredient.calories)}
                        placeholder="קלוריות"
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setMealDraft((previous) => ({
                            ...previous,
                            ingredients: (previous.ingredients || []).map((current: any, index: number) => (
                              index === ingredientIndex ? { ...current, calories: nextValue } : current
                            )),
                          }));
                        }}
                        className="rounded-xl border border-[#DDD4C8] bg-white px-3 py-2 text-right outline-none"
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        value={toInputNumberValue(ingredient.proteinGrams)}
                        placeholder="חלבון"
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setMealDraft((previous) => ({
                            ...previous,
                            ingredients: (previous.ingredients || []).map((current: any, index: number) => (
                              index === ingredientIndex ? { ...current, proteinGrams: nextValue } : current
                            )),
                          }));
                        }}
                        className="rounded-xl border border-[#DDD4C8] bg-white px-3 py-2 text-right outline-none"
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        value={toInputNumberValue(ingredient.carbohydratesGrams)}
                        placeholder="פחמימות"
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setMealDraft((previous) => ({
                            ...previous,
                            ingredients: (previous.ingredients || []).map((current: any, index: number) => (
                              index === ingredientIndex ? { ...current, carbohydratesGrams: nextValue } : current
                            )),
                          }));
                        }}
                        className="rounded-xl border border-[#DDD4C8] bg-white px-3 py-2 text-right outline-none"
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        value={toInputNumberValue(ingredient.fatGrams)}
                        placeholder="שומן"
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setMealDraft((previous) => ({
                            ...previous,
                            ingredients: (previous.ingredients || []).map((current: any, index: number) => (
                              index === ingredientIndex ? { ...current, fatGrams: nextValue } : current
                            )),
                          }));
                        }}
                        className="rounded-xl border border-[#DDD4C8] bg-white px-3 py-2 text-right outline-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onRecalculate}
            className="w-full rounded-full border border-orange px-4 py-2 font-semibold text-orange"
          >
            חשב מחדש סה״כ לפי רכיבים
          </button>

          {mismatchWarning && (
            <p className="rounded-xl bg-yellow-50 px-3 py-2 text-sm font-semibold text-yellow-800">
              {mismatchWarning}
            </p>
          )}

          {validationErrors.length > 0 && (
            <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              {validationErrors.map((error, index) => (
                <p key={`validation-error-${index}`}>{error}</p>
              ))}
            </div>
          )}

          {saveError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {saveError}
            </p>
          )}
        </div>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-full border border-orange py-3 font-bold text-orange"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="flex-1 rounded-full bg-orange py-3 font-bold text-white shadow-md disabled:opacity-60"
          >
            {isSaving ? "שומר..." : "שמור שינויים"}
          </button>
        </div>
      </div>
    </div>
  );
}

function toDateSafe(value: any): Date | null {
  if (!value) return null;

  if (value?.toDate && typeof value.toDate === "function") {
    return value.toDate();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed;
}

function isSameDay(dateValue: any, compareDate: Date) {
  const date = toDateSafe(dateValue);
  if (!date) return false;

  return (
    date.getDate() === compareDate.getDate() &&
    date.getMonth() === compareDate.getMonth() &&
    date.getFullYear() === compareDate.getFullYear()
  );
}

function extractEstimatedCaloriesFromText(text = "") {
  const patterns = [
    /הערכה סבירה:\s*(\d+)/,
    /סה"כ:\s*(\d+)\s*קל/i,
    /סה״כ:\s*(\d+)\s*קל/i,
    /(\d+)\s*קלוריות/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return Number(match[1]);
    }
  }

  return 0;
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function extractEstimatedCalories(meal: MealEntry) {
  return normalizeMealRecordForDisplay(meal).totalCalories || extractEstimatedCaloriesFromText(meal.analysisText || "");
}

function extractMealTitle(meal: MealEntry, fallbackLabel: string) {
  const structuredMealName = normalizeText(meal.analysis?.mealName) ?? normalizeText(meal.mealName);
  if (structuredMealName) return structuredMealName;

  const foodLines = extractFoodLines(meal.analysisText || "");
  const firstFoodLine = foodLines.at(0);
  if (firstFoodLine) return firstFoodLine;

  if (meal.mealNote?.trim()) return meal.mealNote.trim();

  return fallbackLabel;
}

function cleanAnalysisForDisplay(text = "") {
  return text
    .replace(/זהו ניתוח ראשוני של ארוחה:/g, "")
    .replace(/זהו ניתוח ראשוני של תמונת אוכל:/g, "")
    .replace(/This is a preliminary analysis of a food image:/gi, "")
    .replace(/clarification answer:\s*/gi, "")
    .replace(/תשובת הבהרה:\s*/g, "")
    .replace(/שאלת הבהרה:[\s\S]*/g, "")
    .trim();
}

function extractFoodLines(text = "") {
  const cleanedText = cleanAnalysisForDisplay(text);

  const identifiedMatch = cleanedText.match(
    /זיהיתי:\s*([\s\S]*?)(?:\n\n|\nקלוריות משוערות:|$)/
  );

  const sourceBlock = identifiedMatch?.[1] || cleanedText;

  return sourceBlock
    .split("\n")
    .map((line) => line.trim().replace(/^[-•*]\s*/, ""))
    .filter(Boolean)
    .filter(
      (line) =>
        !/^clarification answer[:：]?/i.test(line) &&
        !/^תשובת הבהרה[:：]?/i.test(line) &&
        !/^זהו ניתוח ראשוני/.test(line)
    );
}

function extractNutritionLines(text = "") {
  const lines = cleanAnalysisForDisplay(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.filter((line) => {
    const l = line.toLowerCase();
    return (
      l.startsWith("קלוריות משוערות:") ||
      l.startsWith("הערכה סבירה:") ||
      l.startsWith('סה"כ:') ||
      l.startsWith("סה״כ:") ||
      l.startsWith("מאקרו משוער:") ||
      l.startsWith("חלבון:") ||
      l.startsWith("פחמימות:") ||
      l.startsWith("שומן:") ||
      l.startsWith("protein:") ||
      l.startsWith("carbs:") ||
      l.startsWith("fat:") ||
      l.startsWith("estimated calories:")
    );
  });
}

function extractDetailedIngredientLines(text = "") {
  const lines = cleanAnalysisForDisplay(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const sectionStart = lines.findIndex(
    (line) =>
      line.startsWith("רכיבים מפורטים:") ||
      line.toLowerCase().startsWith("detailed ingredients:")
  );

  if (sectionStart === -1) return [];

  const sectionLines: string[] = [];
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;

    if (
      line.startsWith("קלוריות משוערות:") ||
      line.startsWith("הערכה סבירה:") ||
      line.startsWith("מאקרו משוער:") ||
      line.startsWith("💡") ||
      line.startsWith('סה"כ:') ||
      line.startsWith("סה״כ:")
    ) {
      break;
    }

    sectionLines.push(line.replace(/^[-•*]\s*/, "").trim());
  }

  return sectionLines.filter(Boolean);
}
function extractDetailsLinesFromText(text = "") {
  const detailedIngredients = extractDetailedIngredientLines(text);

  if (detailedIngredients.length > 0) {
    return detailedIngredients.map((line) => {
      const parts = line
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);

      if (parts.length <= 1) return line;

      const name = parts[0] ?? "מרכיב";
      const quantity =
        parts.find((p) => p.includes("כמות")) ?? "כמות משוערת: כמות משוערת לא ידועה";
      const carbs =
        parts.find((p) => p.includes("פחמימות")) ?? "פחמימות: לא ניתן להעריך מהתמונה";
      const fat =
        parts.find((p) => p.includes("שומן") || p.includes("שומנים")) ??
        "שומנים: לא ניתן להעריך מהתמונה";
      const protein =
        parts.find((p) => p.includes("חלבון") || p.includes("חלבונים")) ??
        "חלבונים: לא ניתן להעריך מהתמונה";
      const calories =
        parts.find((p) => p.includes("קלוריות") || p.includes("קל׳")) ??
        "קלוריות: לא ניתן להעריך מהתמונה";

      return `${name}
${quantity}
${carbs} | ${fat} | ${protein}
${calories}`;
    });
  }

  const foodLines = extractFoodLines(text);
  const ingredients = foodLines.slice(1);
  const nutrition = extractNutritionLines(text);

  return [...ingredients, ...nutrition];
}

function extractDetailsLines(meal: MealEntry) {
  const structuredIngredients = normalizeMealRecordForDisplay(meal).ingredients;

  if (structuredIngredients.length > 0) {
    return structuredIngredients.map((ingredient) => {
      const quantity = formatEstimatedQuantityDisplay(ingredient);
      const carbs = formatEstimatedNumericDisplay(ingredient.carbohydratesGrams, " גרם");
      const fat = formatEstimatedNumericDisplay(ingredient.fatGrams, " גרם");
      const protein = formatEstimatedNumericDisplay(ingredient.proteinGrams, " גרם");
      const calories = formatEstimatedNumericDisplay(ingredient.calories, " קל׳");

      return `שם המאכל: ${String(ingredient.name)}
כמות משוערת: ${quantity}
פחמימות: ${carbs} | שומנים: ${fat} | חלבונים: ${protein}
קלוריות: ${calories}`;
    });
  }

  return extractDetailsLinesFromText(meal.analysisText || "");
}

function formatDisplayDate(date: Date) {
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function parseDateKey(dateParam: string | null) {
  if (!dateParam) {
    const now = new Date();
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      12,
      0,
      0,
      0
    );
  }

  const [yearStr, monthStr, dayStr] = dateParam.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!year || !month || !day) {
    const now = new Date();
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      12,
      0,
      0,
      0
    );
  }

  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export default function MealCategoryScreen() {
  const navigate = useNavigate();
  const { mealType } = useParams<{ mealType: MealType }>();
  const [searchParams] = useSearchParams();

  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [mealsPermissionDenied, setMealsPermissionDenied] = useState(false);
  const [favoriteStateByMealId, setFavoriteStateByMealId] = useState<Record<string, boolean>>({});
  const [savingFavoriteIds, setSavingFavoriteIds] = useState<Record<string, boolean>>({});
  const [editingMealId, setEditingMealId] = useState<string | null>(null);
  const [mealEditDraft, setMealEditDraft] = useState<any | null>(null);
  const [mealEditValidationErrors, setMealEditValidationErrors] = useState<string[]>([]);
  const [mealEditSaveError, setMealEditSaveError] = useState<string | null>(null);
  const [mealEditSuccessMessage, setMealEditSuccessMessage] = useState<string | null>(null);
  const [isSavingMealEdit, setIsSavingMealEdit] = useState(false);

  const selectedDate = useMemo(() => {
    return parseDateKey(searchParams.get("date"));
  }, [searchParams]);

  const loadMealsForUser = useCallback(async (userId: string) => {
    setLoading(true);

    try {
      const mealsRef = collection(db, "users", userId, "meals");
      const q = query(mealsRef, orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);

      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as MealEntry[];

      if (DEBUG_MEAL_ANALYSIS && data.length > 0) {
        console.log("[meal-analysis] loaded firestore meal", data[0]);
      }

      setMealsPermissionDenied(false);
      setEntries(data);
    } catch (error) {
      const firebaseError = error as FirebaseError;
      if (firebaseError?.code === "permission-denied") {
        setMealsPermissionDenied(true);
      } else {
        console.error("Failed to load meals:", error);
      }
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;

      if (!user) {
        setEntries([]);
        setMealsPermissionDenied(false);
        setLoading(false);
        return;
      }

      await loadMealsForUser(user.uid);
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
    };
  }, [loadMealsForUser]);



  const filteredMeals = useMemo(() => {
    if (!mealType) return [];

    return entries.filter(
      (entry) =>
        entry.mealType === mealType && isSameDay(entry.createdAt, selectedDate)
    );
  }, [entries, mealType, selectedDate]);

  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId || filteredMeals.length === 0) {
      setFavoriteStateByMealId({});
      return;
    }

    let cancelled = false;

    const syncFavoriteState = async () => {
      const checks = await Promise.all(
        filteredMeals.map(async (meal) => {
          const title = extractMealTitle(meal, mealLabels[mealType]);
          const calories = extractEstimatedCalories(meal);
          try {
            const isFav = await isMealFavorited(userId, title, calories);
            return { id: meal.id, isFav };
          } catch {
            return { id: meal.id, isFav: false };
          }
        })
      );

      if (cancelled) return;

      const nextState: Record<string, boolean> = {};
      checks.forEach((item) => {
        nextState[item.id] = item.isFav;
      });
      setFavoriteStateByMealId(nextState);
    };

    void syncFavoriteState();

    return () => {
      cancelled = true;
    };
  }, [filteredMeals, mealType]);

  const totalCalories = useMemo(() => {
    return filteredMeals.reduce(
      (sum, meal) => sum + extractEstimatedCalories(meal),
      0
    );
  }, [filteredMeals]);

  const closeMealEditModal = useCallback(() => {
    setEditingMealId(null);
    setMealEditDraft(null);
    setMealEditValidationErrors([]);
    setMealEditSaveError(null);
  }, []);

  const openMealEditModal = useCallback((meal: MealEntry, title: string) => {
    const draft = normalizeMealForEdit(meal, title, meal.mealType || "lunch");
    setEditingMealId(meal.id);
    setMealEditDraft(draft);
    setMealEditValidationErrors([]);
    setMealEditSaveError(null);
    console.log("MEAL EDIT OPENED", { mealId: meal.id });
  }, []);

  const handleRecalculateFromIngredients = useCallback(() => {
    setMealEditDraft((previous: any) => {
      if (!previous) return previous;

      const totals = recalculateTotalsFromIngredients(previous.ingredients || []);
      if (!totals.hasAny) return previous;

      return {
        ...previous,
        totalCalories: totals.totalCalories,
        totalProteinGrams: totals.totalProteinGrams,
        totalCarbohydratesGrams: totals.totalCarbohydratesGrams,
        totalFatGrams: totals.totalFatGrams,
      };
    });
  }, []);

  const handleSaveMealEdit = useCallback(async () => {
    if (!editingMealId || !mealEditDraft) return;

    const validationResult = validateMealEditDraft(mealEditDraft);
    if (validationResult.mismatchWarning) {
      console.log("MEAL EDIT VALIDATION WARNING", {
        mealId: editingMealId,
        warningCode: "MACRO_CALORIE_MISMATCH",
      });
    }

    if (!validationResult.ok) {
      setMealEditValidationErrors(validationResult.errors);
      setMealEditSaveError(validationResult.errors[0] || "יש לתקן את השדות המסומנים לפני שמירה.");
      console.log("MEAL EDIT VALIDATION FAILED", {
        mealId: editingMealId,
        errorsCount: validationResult.errors.length,
      });
      return;
    }

    setMealEditValidationErrors([]);
    setMealEditSaveError(null);
    setIsSavingMealEdit(true);
    console.log("MEAL EDIT SAVE STARTED", { mealId: editingMealId });

    try {
      const payload = buildCanonicalMealUpdatePayload(validationResult.draft);
      const response = await updateDiaryMeal(editingMealId, payload);
      const updatedMeal = response?.meal && typeof response.meal === "object"
        ? response.meal
        : {};

      setEntries((previous) => {
        const previousCount = previous.length;
        const hasTargetMeal = previous.some((meal) => meal.id === editingMealId);

        console.log("MEAL EDIT LOCAL UPDATE STARTED", {
          mealId: editingMealId,
          previousMealCount: previousCount,
          selectedCategory: mealType,
          selectedDate: selectedDate.toISOString().slice(0, 10),
        });

        if (!hasTargetMeal) {
          console.log("MEAL EDIT LOCAL UPDATE FAILED", {
            mealId: editingMealId,
            previousMealCount: previousCount,
            nextMealCount: previousCount,
            selectedCategory: mealType,
            selectedDate: selectedDate.toISOString().slice(0, 10),
          });
          return previous;
        }

        const mergedPatch = {
          ...payload,
          ...updatedMeal,
        };

        const next = applyMealUpdateLocally(previous, editingMealId, mergedPatch);

        console.log("MEAL EDIT LOCAL UPDATE APPLIED", {
          mealId: editingMealId,
          previousMealCount: previousCount,
          nextMealCount: next.length,
          selectedCategory: mealType,
          selectedDate: selectedDate.toISOString().slice(0, 10),
        });

        return next;
      });
      closeMealEditModal();
      setMealEditSuccessMessage("הארוחה עודכנה בהצלחה");
      setTimeout(() => setMealEditSuccessMessage(null), 3000);
      console.log("MEAL EDIT SAVED", { mealId: editingMealId });
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === "number"
        ? (error as { status?: number }).status
        : null;
      const code = String((error as { code?: unknown })?.code || "UNKNOWN").trim() || "UNKNOWN";
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "שמירת העריכה נכשלה.";

      console.log("MEAL EDIT PATCH FAILED", {
        mealId: editingMealId,
        status,
        code,
      });
      console.log("MEAL EDIT FAILED", {
        mealId: editingMealId,
        message,
      });
      setMealEditSaveError(message);
    } finally {
      setIsSavingMealEdit(false);
    }
  }, [closeMealEditModal, editingMealId, mealEditDraft, mealType, selectedDate]);

  const mealEditMismatchWarning = useMemo(() => {
    if (!mealEditDraft) return null;
    return getMacroMismatchWarning(mealEditDraft);
  }, [mealEditDraft]);

  if (!mealType || !mealLabels[mealType]) {
    return (
      <div dir="rtl" className="min-h-screen bg-cream px-6 py-8">
        <p className="text-center text-lg text-red-500">סוג ארוחה לא תקין</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-cream">
      <div className="mx-auto min-h-screen w-full max-w-150 bg-cream pb-12">
        <MealPageHeader onBack={() => navigate(-1)} />

        <MealSectionBanner
          icon={mealIcons[mealType]}
          title={mealLabels[mealType]}
        />

        <div className="px-4 pt-4 text-center text-lg font-semibold text-dark">
          {formatDisplayDate(selectedDate)}
        </div>

        {mealsPermissionDenied && (
          <div className="mx-4 mt-3 rounded-2xl border border-orange/30 bg-white px-4 py-3 text-center text-sm font-semibold text-orange">
            אין הרשאה לטעון את הארוחות מהשרת כרגע. נסי להתחבר מחדש.
          </div>
        )}

        {mealEditSuccessMessage && (
          <div className="mx-4 mt-3 rounded-2xl bg-orange px-4 py-3 text-center text-sm font-semibold text-white">
            {mealEditSuccessMessage}
          </div>
        )}

        <div className="px-4 py-8">
          <AddMealButton onClick={() => navigate("/my-meals", { state: { preselectedMealType: mealType } })} />

          {loading ? (
            <p className="text-center text-lg text-placeholder">טוען ארוחות...</p>
          ) : filteredMeals.length === 0 ? (
            <div className="rounded-3xl bg-white px-6 py-10 text-center shadow-sm">
              <p className="text-xl font-semibold text-orange">
                עדיין אין ארוחות בקטגוריה הזאת לתאריך הזה
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {filteredMeals.map((meal) => {
                const title = extractMealTitle(meal, mealLabels[mealType]);
                const calories = extractEstimatedCalories(meal);
                const detailsLines = extractDetailsLines(meal);
                const isFavorited = favoriteStateByMealId[meal.id] ?? false;
                const isSavingFavorite = savingFavoriteIds[meal.id] ?? false;

                return (
                  <div key={meal.id} className="overflow-hidden rounded-2xl">
                    <MealImage
                      src={meal.imageUrl}
                      alt={title}
                    />

                    <MealCardShell
                      title={title}
                      calories={calories}
                      details={detailsLines}
                      isFavorited={isFavorited}
                      isSavingFavorite={isSavingFavorite}
                      onEditClick={() => openMealEditModal(meal, title)}
                      onFavoriteClick={() => {
                        const userId = auth.currentUser?.uid;
                        if (!userId || isFavorited || isSavingFavorite) return;

                        setSavingFavoriteIds((prev) => ({ ...prev, [meal.id]: true }));

                        void (async () => {
                          try {
                            const normalizedMeal = normalizeMealRecordForDisplay(meal);

                            await addFavorite(userId, {
                              name: title,
                              calories,
                              imageUrl: meal.imageUrl ?? undefined,
                              source: "saved_from_meal",
                              ingredients: normalizedMeal.ingredients,
                              ...(normalizedMeal.totalProteinGrams != null ? { protein: normalizedMeal.totalProteinGrams } : {}),
                              ...(normalizedMeal.totalCarbohydratesGrams != null ? { carbs: normalizedMeal.totalCarbohydratesGrams } : {}),
                              ...(normalizedMeal.totalFatGrams != null ? { fat: normalizedMeal.totalFatGrams } : {}),
                            });

                            setFavoriteStateByMealId((prev) => ({
                              ...prev,
                              [meal.id]: true,
                            }));
                          } catch (error) {
                            console.error("Failed to save favorite:", error);
                          } finally {
                            setSavingFavoriteIds((prev) => ({ ...prev, [meal.id]: false }));
                          }
                        })();
                      }}
                      expanded
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!loading && filteredMeals.length > 0 && (
          <div className="px-4 pb-8">
            <div className="rounded-2xl bg-orange px-6 py-5 text-white shadow-sm">
              <div className="flex items-center justify-between text-2xl font-bold">
                <span>סה״כ לקטגוריה</span>
                <span>{totalCalories} קל׳</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {editingMealId && mealEditDraft && (
        <MealEditModal
          mealDraft={mealEditDraft}
          setMealDraft={setMealEditDraft}
          validationErrors={mealEditValidationErrors}
          saveError={mealEditSaveError}
          isSaving={isSavingMealEdit}
          mismatchWarning={mealEditMismatchWarning}
          onRecalculate={handleRecalculateFromIngredients}
          onCancel={closeMealEditModal}
          onSave={() => {
            void handleSaveMealEdit();
          }}
        />
      )}
    </div>
  );
}