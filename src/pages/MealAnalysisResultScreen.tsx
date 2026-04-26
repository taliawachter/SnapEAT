import { Heart, ChevronRight, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { auth } from "../firebase.js";
import { saveAnalyzedMealToDiary, toAbsoluteUploadUrl } from "../utils/mealsApi.js";
import type { AnalyzeMealResponse, MealType } from "../types/mealAnalysis.js";

type LocationState = {
  analysisResult?: AnalyzeMealResponse;
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

  const [selectedMealType, setSelectedMealType] = useState<MealType>("lunch");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        imageUrl: analysisResult.imageUrl,
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
                <button type="button" aria-label="מועדפים">
                  <Heart className="h-7 w-7" />
                </button>
              </div>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div>
                <h3 className="mb-2 text-lg font-bold text-dark">רכיבים שזוהו</h3>
                <ul className="space-y-2">
                  {analysisResult.analysis.ingredients.map((ingredient) => (
                    <li
                      key={`${ingredient.name}-${ingredient.calories}`}
                      className="flex items-center justify-between rounded-xl bg-borange px-3 py-2 text-base text-dark"
                    >
                      <span>{ingredient.name}</span>
                      <span className="font-semibold">{ingredient.calories} קל׳</span>
                    </li>
                  ))}
                </ul>
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
