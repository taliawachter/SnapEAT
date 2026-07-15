import { Heart, ChevronRight, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { auth } from "../firebase.js";
import { saveAnalyzedMealToDiary, toAbsoluteUploadUrl } from "../utils/mealsApi.js";
import { addFavorite, isMealFavorited } from "../utils/favoritesApi.js";
import type { AnalyzeMealResponse, MealType } from "../types/mealAnalysis.js";
import {
  formatEstimatedNumericDisplay,
  formatEstimatedQuantityDisplay,
  normalizeMealAnalysis,
} from "../../shared/meal-analysis.js";

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
  const normalizedAnalysis = useMemo(
    () => normalizeMealAnalysis(analysisResult?.analysis || {}),
    [analysisResult?.analysis],
  );

  const absoluteImageUrl = useMemo(() => {
    if (!analysisResult?.imageUrl) return "";
    return toAbsoluteUploadUrl(analysisResult.imageUrl);
  }, [analysisResult?.imageUrl]);

  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId || !analysisResult) {
      setIsFavorited(false);
      return;
    }

    let cancelled = false;

    const syncFavoriteState = async () => {
      try {
        const exists = await isMealFavorited(
          userId,
          normalizedAnalysis.mealName,
          normalizedAnalysis.totalCalories,
        );
        if (!cancelled) setIsFavorited(exists);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to check favorite state:", error);
          setIsFavorited(false);
        }
      }
    };

    void syncFavoriteState();

    return () => {
      cancelled = true;
    };
  }, [analysisResult]);

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
        mealName: normalizedAnalysis.mealName,
        imageUrl: toAbsoluteUploadUrl(analysisResult.imageUrl),
        ingredients: normalizedAnalysis.ingredients,
        totalCalories: normalizedAnalysis.totalCalories,
        date: new Date().toISOString(),
        ...(normalizedAnalysis.totalProteinGrams != null
          ? { protein: normalizedAnalysis.totalProteinGrams }
          : {}),
        ...(normalizedAnalysis.totalCarbohydratesGrams != null
          ? { carbs: normalizedAnalysis.totalCarbohydratesGrams }
          : {}),
        ...(normalizedAnalysis.totalFatGrams != null
          ? { fat: normalizedAnalysis.totalFatGrams }
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
              alt={normalizedAnalysis.mealName}
              className="h-64 w-full object-cover sm:h-80"
            />
          </div>

          <div className="mt-6 overflow-hidden rounded-3xl border border-brown bg-white text-right shadow-[0_14px_30px_rgba(0,0,0,0.08)]">
            <div className="flex items-center justify-between border-b border-brown px-5 py-4">
              <div className="flex items-center gap-4 text-orange">
                <h2 className="text-xl font-bold text-black">{normalizedAnalysis.mealName}</h2>
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
                        calories: normalizedAnalysis.totalCalories,
                        imageUrl: toAbsoluteUploadUrl(analysisResult.imageUrl),
                        source: "saved_from_meal",
                        ingredients: normalizedAnalysis.ingredients,
                        ...(normalizedAnalysis.totalProteinGrams != null
                          ? { protein: normalizedAnalysis.totalProteinGrams }
                          : {}),
                        ...(normalizedAnalysis.totalCarbohydratesGrams != null
                          ? { carbs: normalizedAnalysis.totalCarbohydratesGrams }
                          : {}),
                        ...(normalizedAnalysis.totalFatGrams != null
                          ? { fat: normalizedAnalysis.totalFatGrams }
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
                  {normalizedAnalysis.ingredients.map((ingredient, index) => {
                    const quantity = formatEstimatedQuantityDisplay(ingredient);
                    const calories = formatEstimatedNumericDisplay(ingredient.calories, " קל׳");
                    const protein = formatEstimatedNumericDisplay(ingredient.proteinGrams, " גרם");
                    const carbs = formatEstimatedNumericDisplay(ingredient.carbohydratesGrams, " גרם");
                    const fat = formatEstimatedNumericDisplay(ingredient.fatGrams, " גרם");

                    return (
                      <div
                        key={`${String(ingredient.name)}-${index}`}
                        className="rounded-2xl border border-orange-200 bg-white/90 p-4 text-right shadow-sm"
                      >
                        <h3 className="text-xl font-bold text-gray-800">{ingredient.name}</h3>
                        <p className="mt-2 text-base text-gray-600">כמות משוערת: {quantity}</p>
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
                <p className="text-lg font-bold text-orange">הערכה תזונתית: {normalizedAnalysis.totalCalories} קל׳</p>
                {(normalizedAnalysis.totalProteinGrams != null ||
                  normalizedAnalysis.totalCarbohydratesGrams != null ||
                  normalizedAnalysis.totalFatGrams != null) && (
                  <div className="mt-2 flex flex-wrap gap-4 text-sm">
                    <span>חלבון: {formatEstimatedNumericDisplay(normalizedAnalysis.totalProteinGrams, " גרם")}</span>
                    <span>פחמימות: {formatEstimatedNumericDisplay(normalizedAnalysis.totalCarbohydratesGrams, " גרם")}</span>
                    <span>שומן: {formatEstimatedNumericDisplay(normalizedAnalysis.totalFatGrams, " גרם")}</span>
                  </div>
                )}
                {normalizedAnalysis.estimationNotes?.length ? (
                  <p className="mt-2 text-sm text-placeholder">
                    {normalizedAnalysis.estimationNotes.join(" | ")}
                  </p>
                ) : null}
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
