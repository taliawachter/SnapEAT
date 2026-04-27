import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronRight, Heart, Plus, Trash2 } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import type { FirebaseError } from "firebase/app";
import { auth } from "../firebase.js";
import {
  addFavoriteToDiary,
  addFavorite,
  getFavorites,
  removeFavorite,
} from "../utils/favoritesApi.js";
import { toAbsoluteUploadUrl } from "../utils/mealsApi.js";
import type { FavoriteMeal, MealType } from "../types/mealAnalysis.js";

const mealTypeOptions: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "ארוחת בוקר" },
  { value: "lunch", label: "ארוחת צהריים" },
  { value: "dinner", label: "ארוחת ערב" },
  { value: "snack", label: "ארוחת ביניים" },
];

export default function FavoriteMealsScreen() {
  const navigate = useNavigate();

  const [userId, setUserId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<FavoriteMeal[]>([]);
  const [loading, setLoading] = useState(true);

  const [pendingFavorite, setPendingFavorite] = useState<FavoriteMeal | null>(null);
  const [selectedMealType, setSelectedMealType] = useState<MealType>("lunch");
  const [isAdding, setIsAdding] = useState(false);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualCalories, setManualCalories] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [isSavingManual, setIsSavingManual] = useState(false);

  const loadFavorites = useCallback(async (uid: string) => {
    setLoading(true);
    try {
      const data = await getFavorites(uid);
      setFavorites(data);
    } catch (error) {
      const fe = error as FirebaseError;
      if (fe?.code !== "permission-denied") {
        console.error("Failed to load favorites:", error);
      }
      setFavorites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate("/hello", { replace: true });
        return;
      }
      setUserId(user.uid);
      void loadFavorites(user.uid);
    });
    return () => unsubscribe();
  }, [navigate, loadFavorites]);

  const handleRemove = async (favoriteId: string) => {
    if (!userId) return;
    try {
      await removeFavorite(userId, favoriteId);
      setFavorites((prev) => prev.filter((f) => f.id !== favoriteId));
    } catch (error) {
      console.error("Failed to remove favorite:", error);
    }
  };

  const handleAddToToday = async () => {
    if (!userId || !pendingFavorite) return;
    setIsAdding(true);
    setErrorMessage(null);
    try {
      await addFavoriteToDiary(userId, pendingFavorite, selectedMealType);
      localStorage.setItem("nutritionJournal_periodIndex", "0");
      localStorage.setItem("nutritionJournal_activeTab", "daily");
      const name = pendingFavorite.name;
      setPendingFavorite(null);
      setSuccessMessage(`${name} נוסף ליומן היום!`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      console.error("Failed to add to diary:", error);
      setErrorMessage("הוספה ליומן נכשלה. נסי שוב.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleSaveManualFavorite = async () => {
    if (!userId) return;

    const normalizedName = manualName.trim();
    const calories = Number(manualCalories);

    if (!normalizedName || Number.isNaN(calories) || calories <= 0) {
      setManualError("יש להזין שם ארוחה וקלוריות תקינות");
      return;
    }

    const protein = manualProtein.trim() ? Number(manualProtein) : undefined;
    const carbs = manualCarbs.trim() ? Number(manualCarbs) : undefined;
    const fat = manualFat.trim() ? Number(manualFat) : undefined;

    if (
      (protein != null && Number.isNaN(protein)) ||
      (carbs != null && Number.isNaN(carbs)) ||
      (fat != null && Number.isNaN(fat))
    ) {
      setManualError("שדות מאקרו חייבים להיות מספריים");
      return;
    }

    setIsSavingManual(true);
    setManualError(null);

    try {
      await addFavorite(userId, {
        name: normalizedName,
        calories,
        source: "manual",
        ...(protein != null ? { protein } : {}),
        ...(carbs != null ? { carbs } : {}),
        ...(fat != null ? { fat } : {}),
      });

      await loadFavorites(userId);

      setManualName("");
      setManualCalories("");
      setManualProtein("");
      setManualCarbs("");
      setManualFat("");
      setIsManualModalOpen(false);
      setSuccessMessage("ארוחה מועדפת נוספה בהצלחה");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      console.error("Failed to save manual favorite:", error);
      setManualError("שמירה נכשלה, נסי שוב");
    } finally {
      setIsSavingManual(false);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-cream">
      <div className="mx-auto flex min-h-screen w-full max-w-150 flex-col bg-cream pb-20">
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

            <h1 className="text-2xl font-bold text-orange">מועדפים</h1>

            <div className="h-11 w-11" />
          </div>
        </header>

        {successMessage && (
          <div className="mx-4 mb-2 rounded-2xl bg-orange px-4 py-3 text-center font-semibold text-white shadow-sm">
            {successMessage}
          </div>
        )}

        {errorMessage && (
          <div className="mx-4 mb-2 rounded-2xl bg-red-500 px-4 py-3 text-center font-semibold text-white shadow-sm">
            {errorMessage}
          </div>
        )}

        <main className="flex-1 px-4 pt-4">
          {loading ? (
            <div className="py-16 text-center text-lg text-placeholder">
              טוען מועדפים...
            </div>
          ) : favorites.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <Heart className="mb-4 h-16 w-16 text-orange/30" />
              <p className="text-xl font-semibold text-placeholder">אין עדיין מועדפים</p>
              <p className="mt-2 text-base text-placeholder">
                לחצי על לב בארוחה כדי להוסיפה למועדפים
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {favorites.map((favorite) => (
                <FavoriteCard
                  key={favorite.id}
                  favorite={favorite}
                  onAddToToday={() => {
                    setPendingFavorite(favorite);
                    setSelectedMealType("lunch");
                    setErrorMessage(null);
                  }}
                  onRemove={() => void handleRemove(favorite.id)}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Meal-type picker modal */}
      {pendingFavorite && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-6"
          onClick={() => setPendingFavorite(null)}
        >
          <div
            className="w-full max-w-150 rounded-3xl bg-cream p-6 shadow-2xl"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-xl font-bold text-orange">
              הוסף להיום
            </h2>
            <p className="mb-4 text-base text-dark">{pendingFavorite.name}</p>

            <p className="mb-3 text-base font-semibold text-dark">בחרי סוג ארוחה:</p>
            <div className="space-y-2">
              {mealTypeOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center justify-between rounded-xl border border-[#DDD4C8] px-3 py-3"
                >
                  <span className="font-semibold text-dark">{option.label}</span>
                  <input
                    type="radio"
                    name="add-meal-type"
                    value={option.value}
                    checked={selectedMealType === option.value}
                    onChange={() => setSelectedMealType(option.value)}
                    className="h-4 w-4 accent-orange"
                  />
                </label>
              ))}
            </div>

            {errorMessage && (
              <p className="mt-3 text-center text-sm text-red-500">{errorMessage}</p>
            )}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setPendingFavorite(null)}
                className="flex-1 rounded-full border border-orange py-3 font-bold text-orange"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={() => void handleAddToToday()}
                disabled={isAdding}
                className="flex-1 rounded-full bg-orange py-3 font-bold text-white shadow-md disabled:opacity-60"
              >
                {isAdding ? "מוסיף..." : "הוסף"}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        aria-label="הוספת מועדף ידני"
        onClick={() => {
          setManualError(null);
          setIsManualModalOpen(true);
        }}
        className="fixed bottom-6 left-1/2 z-40 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-orange text-white shadow-lg hover:bg-orange/90 active:scale-95"
      >
        <Plus className="h-7 w-7" />
      </button>

      {isManualModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-6"
          onClick={() => setIsManualModalOpen(false)}
        >
          <div
            className="w-full max-w-150 rounded-3xl bg-cream p-6 shadow-2xl"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-xl font-bold text-orange">ארוחה מועדפת חדשה</h2>
            <p className="mb-4 text-sm text-placeholder">שדות חובה: שם ארוחה, קלוריות</p>

            <div className="space-y-3">
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="שם ארוחה"
                className="w-full rounded-xl border border-[#DDD4C8] bg-white px-3 py-3 text-right outline-none"
              />
              <input
                type="number"
                min="1"
                value={manualCalories}
                onChange={(e) => setManualCalories(e.target.value)}
                placeholder="קלוריות"
                className="w-full rounded-xl border border-[#DDD4C8] bg-white px-3 py-3 text-right outline-none"
              />
              <input
                type="number"
                min="0"
                value={manualProtein}
                onChange={(e) => setManualProtein(e.target.value)}
                placeholder="חלבון (אופציונלי)"
                className="w-full rounded-xl border border-[#DDD4C8] bg-white px-3 py-3 text-right outline-none"
              />
              <input
                type="number"
                min="0"
                value={manualCarbs}
                onChange={(e) => setManualCarbs(e.target.value)}
                placeholder="פחמימות (אופציונלי)"
                className="w-full rounded-xl border border-[#DDD4C8] bg-white px-3 py-3 text-right outline-none"
              />
              <input
                type="number"
                min="0"
                value={manualFat}
                onChange={(e) => setManualFat(e.target.value)}
                placeholder="שומנים (אופציונלי)"
                className="w-full rounded-xl border border-[#DDD4C8] bg-white px-3 py-3 text-right outline-none"
              />
            </div>

            {manualError && (
              <p className="mt-3 text-center text-sm text-red-500">{manualError}</p>
            )}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="flex-1 rounded-full border border-orange py-3 font-bold text-orange"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={() => void handleSaveManualFavorite()}
                disabled={isSavingManual}
                className="flex-1 rounded-full bg-orange py-3 font-bold text-white shadow-md disabled:opacity-60"
              >
                {isSavingManual ? "שומר..." : "שמירה"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FavoriteCard({
  favorite,
  onAddToToday,
  onRemove,
}: {
  favorite: FavoriteMeal;
  onAddToToday: () => void;
  onRemove: () => void;
}) {
  const imageUrl = favorite.imageUrl ? toAbsoluteUploadUrl(favorite.imageUrl) : null;
  const hasMacros =
    favorite.protein != null || favorite.carbs != null || favorite.fat != null;

  return (
    <div className="overflow-hidden rounded-3xl border border-brown bg-white shadow-[0_4px_16px_rgba(0,0,0,0.07)]">
      {imageUrl && (
        <img
          src={imageUrl}
          alt={favorite.name}
          className="h-40 w-full object-cover"
        />
      )}

      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-xl font-bold text-dark">{favorite.name}</h3>
          <button
            type="button"
            onClick={onRemove}
            aria-label="הסרה ממועדפים"
            className="shrink-0 rounded-full p-1 text-orange transition hover:bg-orange/10"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-1 text-lg font-semibold text-orange">
          {favorite.calories} קל׳
        </p>

        {hasMacros && (
          <p className="mt-1 text-sm text-placeholder">
            {[
              favorite.carbs != null && `פחמימות ${favorite.carbs} גרם`,
              favorite.fat != null && `שומנים ${favorite.fat} גרם`,
              favorite.protein != null && `חלבונים ${favorite.protein} גרם`,
            ]
              .filter(Boolean)
              .join(" | ")}
          </p>
        )}

        <button
          type="button"
          onClick={onAddToToday}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-orange py-3 font-bold text-white shadow-sm transition hover:bg-orange/90 active:scale-95"
        >
          <Plus className="h-5 w-5" />
          הוסף להיום
        </button>
      </div>
    </div>
  );
}
