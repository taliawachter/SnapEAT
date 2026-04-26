import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { collection, getDocs, orderBy, query } from "firebase/firestore/lite";
import { onAuthStateChanged } from "firebase/auth";
import type { FirebaseError } from "firebase/app";
import { ChevronRight, Heart, Pencil } from "lucide-react";
import { auth, db } from "../firebase.js";

type MealType = "breakfast" | "lunch" | "dinner" | "snack";

type MealEntry = {
  id: string;
  mealType?: MealType;
  mealNote?: string;
  analysisText?: string;
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
  expanded = false,
}: {
  title: string;
  calories: number;
  details: string[];
  expanded?: boolean;
}) {
  return (
    <div className="mt-6 w-full overflow-hidden rounded-3xl border border-brown bg-white text-right shadow-[0_14px_30px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between border-b border-brown px-5 py-4">
        <div className="flex items-center gap-4 text-orange">
           <h2 className="text-xl font-bold text-black">{title}</h2>
          <button type="button" aria-label="עריכה">
            <Pencil className="h-8 w-8" />
          </button>
          <button type="button" aria-label="מועדפים">
            <Heart className="h-8 w-8 fill-orange text-orange" />
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
                  <p className="text-right text-2xl font-semibold text-dark">{line}</p>
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

function extractEstimatedCalories(text = "") {
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

function extractMealTitle(meal: MealEntry, fallbackLabel: string) {
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

function extractDetailsLines(text = "") {
  const detailedIngredients = extractDetailedIngredientLines(text);
  if (detailedIngredients.length > 0) {
    return detailedIngredients.flatMap((line) => {
      const parts = line
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);

      if (parts.length <= 1) return [line];

      return parts;
    });
  }

  const foodLines = extractFoodLines(text);
  const ingredients = foodLines.slice(1);
  const nutrition = extractNutritionLines(text);

  return [...ingredients, ...nutrition];
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

  const totalCalories = useMemo(() => {
    return filteredMeals.reduce(
      (sum, meal) => sum + extractEstimatedCalories(meal.analysisText || ""),
      0
    );
  }, [filteredMeals]);

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
                const calories = extractEstimatedCalories(meal.analysisText || "");
                const detailsLines = extractDetailsLines(meal.analysisText || "");

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
    </div>
  );
}