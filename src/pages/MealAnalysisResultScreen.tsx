import { Heart, ChevronRight, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { auth } from "../firebase.js";
import { saveAnalyzedMealToDiary, toAbsoluteUploadUrl } from "../utils/mealsApi.js";
import { addFavorite } from "../utils/favoritesApi.js";
import type { AnalyzeMealResponse, MealType } from "../types/mealAnalysis.js";

type LocationState = {
  analysisResult?: AnalyzeMealResponse;
  preselectedMealType?: MealType;
};

const mealTypeOptions: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "ארוחת בוקר" },
  { value: "lunch", label: "ארוחת צהריים" },
  { value: "dinner", label: "ארוחת ערב" },
  { value: "snack", label: "ארוחת ביניים" },
];

const valueOrMissing = (value: unknown) => value ?? "לא זמין";

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getIngredientField(ingredient: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = ingredient[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function formatQuantity(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  const numeric = normalizeNumber(value);
  if (numeric !== undefined) return `${numeric} גרם`;
  return "לא זמין";
}

function formatMacro(value: unknown) {
  const numeric = normalizeNumber(value);
  return numeric !== undefined ? `${numeric} גרם` : "לא זמין";
}

function formatCalories(value: unknown) {
  const numeric = normalizeNumber(value);
  return numeric !== undefined ? `${numeric} קל׳` : "לא זמין";
}

export default function MealAnalysisResultScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const defaultMealType: MealType = state?.preselectedMealType ?? "lunch";

  const [selectedMealType, setSelectedMealType] = useState<MealType>(defaultMealType);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [isSavingFavorite, setIsSavingFavorite] = useState(false);

  const analysisResult = state?.analysisResult;

  const absoluteImageUrl = useMemo(() => {
    if (!analysisResult?.imageUrl) return "";
    return toAbsoluteUploadUrl(analysisResult.imageUrl);
  }, [analysisResult?.imageUrl]);

  if (!analysisResult) {
    return (
      <div dir="rtl" className="min-h-screen bg-cream px-4 py-10">
        <div className="mx-auto w-full max-w-150 rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-dark">אין נתוני ניתוח להצגה.</p>
          <button
            type="button"
            onClick={() => navigate("/my-meals")}
            className="mt-4 rounded-full bg-orange px-6 py-2 font-bold text-white"
          >
            חזרה לארוחות שלי
          </button>
        </div>
      </div>
    );
  }

  const handleSaveToDiary = async () => {
    const userId = auth.currentUser?.uid;

    if (!userId) {
      setErrorMessage("צריך להתחבר כדי להוסיף ליומן.");
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const diaryPayload = {
        userId,
        mealType: selectedMealType,
        mealName: analysisResult.analysis.mealName,
        imageUrl: toAbsoluteUploadUrl(analysisResult.imageUrl),
        ingredients: analysisResult.analysis.ingredients,
        totalCalories: analysisResult.analysis.totalCalories,
        date: new Date().toISOString(),
        ...(analysisResult.analysis.protein != null
          ? { protein: analysisResult.analysis.protein }
          : {}),
        ...(analysisResult.analysis.carbs != null
          ? { carbs: analysisResult.analysis.carbs }
          : {}),
        ...(analysisResult.analysis.fat != null
          ? { fat: analysisResult.analysis.fat }
          : {}),
      };

      await saveAnalyzedMealToDiary(diaryPayload);

      localStorage.setItem("nutritionJournal_periodIndex", "0");
      localStorage.setItem("nutritionJournal_activeTab", "daily");

      navigate("/home", { replace: true });
    } catch (error) {
      setErrorMessage("שמירת הארוחה נכשלה. נסי שוב.");
      console.error("Failed to save meal", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-cream">
      <div className="mx-auto flex min-h-screen w-full max-w-150 flex-col bg-cream pb-8">
        <header className="px-4 pt-10 pb-4">
          <div className="flex items-center justify-between border-b border-[#CFC9C1] pb-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-full p-2 text-orange transition hover:bg-orange/10"
              aria-label="חזרה"
            >
              <ChevronRight className="h-7 w-7" />
            </button>

            <h1 className="text-2xl font-bold text-orange">הארוחות שלי</h1>

            <div className="h-11 w-11" />
          </div>
        </header>

        <main className="flex-1 px-4 pt-4">
          <div className="overflow-hidden rounded-2xl shadow-md">
            <img
              src={absoluteImageUrl}
              alt={analysisResult.analysis.mealName}
              className="h-64 w-full object-cover sm:h-80"
            />
          </div>

          <div className="mt-6 overflow-hidden rounded-3xl border border-brown bg-white text-right shadow-[0_14px_30px_rgba(0,0,0,0.08)]">
            <div className="flex items-center justify-between border-b border-brown px-5 py-4">
              <div className="flex items-center gap-4 text-orange">
                <h2 className="text-xl font-bold text-black">{analysisResult.analysis.mealName}</h2>
                <button type="button" aria-label="עריכה">
                  <Pencil className="h-7 w-7" />
                </button>
                <button
                  type="button"
                  aria-label="מועדפים"
                  disabled={isSavingFavorite}
                  onClick={async () => {
                    const userId = auth.currentUser?.uid;
                    if (!userId || isFavorited || isSavingFavorite) return;
                    setIsSavingFavorite(true);
                    try {
                      await addFavorite(userId, {
                        name: analysisResult.analysis.mealName,
                        calories: analysisResult.analysis.totalCalories,
                        imageUrl: toAbsoluteUploadUrl(analysisResult.imageUrl),
                        ingredients: analysisResult.analysis.ingredients,
                        ...(analysisResult.analysis.protein != null
                          ? { protein: analysisResult.analysis.protein }
                          : {}),
                        ...(analysisResult.analysis.carbs != null
                          ? { carbs: analysisResult.analysis.carbs }
                          : {}),
                        ...(analysisResult.analysis.fat != null
                          ? { fat: analysisResult.analysis.fat }
                          : {}),
                      });
                      setIsFavorited(true);
                    } catch (err) {
                      console.error("Failed to save favorite:", err);
                    } finally {
                      setIsSavingFavorite(false);
                    }
                  }}
                >
                  <Heart
                    className={`h-7 w-7 transition ${
                      isFavorited ? "fill-orange text-orange" : ""
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div>
                <h3 className="mb-2 text-lg font-bold text-dark">רכיבים שזוהו</h3>
                <div className="space-y-4">
                  {analysisResult.analysis.ingredients.map((ingredient, index) => {
                    const ingredientData = ingredient as Record<string, unknown>;

                    const name = valueOrMissing(
                      getIngredientField(ingredientData, ["name", "foodName", "ingredientName"]) ?? "מרכיב"
                    );
                    const quantity = formatQuantity(
                      getIngredientField(ingredientData, ["quantity", "amount", "grams"])
                    );
                    const calories = formatCalories(
                      getIngredientField(ingredientData, ["calories", "kcal"])
                    );
                    const protein = formatMacro(
                      getIngredientField(ingredientData, ["protein"])
                    );
                    const carbs = formatMacro(
                      getIngredientField(ingredientData, ["carbs", "carbohydrates"])
                    );
                    const fat = formatMacro(
                      getIngredientField(ingredientData, ["fat", "fats"])
                    );

                    return (
                      <div
                        key={`${String(name)}-${index}`}
                        className="rounded-2xl border border-orange-200 bg-white/90 p-4 text-right shadow-sm"
                      >
                        <h3 className="text-xl font-bold text-gray-800">{String(name)}</h3>
                        <p className="mt-2 text-base text-gray-600">כמות: {quantity}</p>
                        <p className="mt-2 text-base leading-7 text-gray-700">
                          פחמימות: {carbs} | שומנים: {fat} | חלבונים: {protein}
                        </p>
                        <p className="mt-3 text-lg font-bold text-orange-500">קלוריות: {calories}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl bg-[#F5EEE4] px-4 py-3 text-base text-dark">
                <p className="text-lg font-bold text-orange">סה״כ: {analysisResult.analysis.totalCalories} קל׳</p>
                {(analysisResult.analysis.protein != null ||
                  analysisResult.analysis.carbs != null ||
                  analysisResult.analysis.fat != null) && (
                  <div className="mt-2 flex flex-wrap gap-4 text-sm">
                    {analysisResult.analysis.protein != null && <span>חלבון: {analysisResult.analysis.protein} גרם</span>}
                    {analysisResult.analysis.carbs != null && <span>פחמימות: {analysisResult.analysis.carbs} גרם</span>}
                    {analysisResult.analysis.fat != null && <span>שומן: {analysisResult.analysis.fat} גרם</span>}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-base font-bold text-dark">בחרי סוג ארוחה</p>
                <div className="space-y-2">
                  {mealTypeOptions.map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center justify-between rounded-xl border border-[#DDD4C8] px-3 py-2"
                    >
                      <span className="font-semibold text-dark">{option.label}</span>
                      <input
                        type="radio"
                        name="meal-type"
                        value={option.value}
                        checked={selectedMealType === option.value}
                        onChange={() => setSelectedMealType(option.value)}
                        className="h-4 w-4 accent-orange"
                      />
                    </label>
                  ))}
                </div>
              </div>

              {errorMessage && <p className="text-sm font-semibold text-red-600">{errorMessage}</p>}

              <button
                type="button"
                onClick={handleSaveToDiary}
                disabled={isSaving}
                className="w-full rounded-full bg-orange px-6 py-3 text-xl font-bold text-white shadow-md transition hover:bg-orange/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "שומרת..." : "הוסף ליומן"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
