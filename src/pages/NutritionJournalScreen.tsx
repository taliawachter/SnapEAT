import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Menu,
  Plus,
  Heart,
  Coffee,
  Hamburger,
  Salad,
  Apple,
  CalendarDays,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { MdOutlineWhatsapp } from "react-icons/md";
import { BsChatLeftDots } from "react-icons/bs";
import { collection, getDocs, orderBy, query } from "firebase/firestore/lite";
import { onAuthStateChanged } from "firebase/auth";
import type { FirebaseError } from "firebase/app";
import { openWhatsAppChat } from "../utils/whatsapp.js";
import { auth, db } from "../firebase.js";
import ProfileDrawer from "./ProfileDrawer.js";

type TabKey = "daily" | "weekly" | "monthly";
type MealType = "breakfast" | "lunch" | "dinner" | "snack";

type MealEntry = {
  id: string;
  mealType?: MealType;
  mealNote?: string;
  analysisText?: string;
  createdAt?: any;
  imageUrl?: string | null;
};

type Meal = {
  id: MealType;
  title: string;
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  icon: React.ReactNode;
};

type PeriodData = {
  calories: number;
  carbs?: number;
  protein?: number;
  fat?: number;
  chartPoints?: number[];
  chartLabels?: string[];
  chartTitle?: string;
  meals?: Meal[];
};

const STORAGE_KEYS = {
  activeTab: "nutritionJournal_activeTab",
  periodIndex: "nutritionJournal_periodIndex",
};

const fallbackJournalData: Record<TabKey, PeriodData> = {
  daily: {
    calories: 0,
    meals: [
      {
        id: "breakfast",
        title: "בוקר",
        calories: 0,
        carbs: 0,
        protein: 0,
        fat: 0,
        icon: <Coffee className="h-7 w-7" />,
      },
      {
        id: "lunch",
        title: "צהריים",
        calories: 0,
        carbs: 0,
        protein: 0,
        fat: 0,
        icon: <Hamburger className="h-7 w-7" />,
      },
      {
        id: "dinner",
        title: "ערב",
        calories: 0,
        carbs: 0,
        protein: 0,
        fat: 0,
        icon: <Salad className="h-7 w-7" />,
      },
      {
        id: "snack",
        title: "ביניים",
        calories: 0,
        carbs: 0,
        protein: 0,
        fat: 0,
        icon: <Apple className="h-7 w-7" />,
      },
    ],
  },
  weekly: {
    calories: 0,
    carbs: 0,
    protein: 0,
    fat: 0,
    chartPoints: [0, 0, 0, 0, 0, 0, 0],
    chartLabels: ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"],
    chartTitle: "מבט שבועי",
  },
  monthly: {
    calories: 0,
    carbs: 0,
    protein: 0,
    fat: 0,
    chartPoints: [0, 0, 0, 0],
    chartLabels: ["1", "8", "15", "22"],
    chartTitle: "מבט חודשי",
  },
};

const tabs: { key: TabKey; label: string }[] = [
  { key: "daily", label: "יומי" },
  { key: "weekly", label: "שבועי" },
  { key: "monthly", label: "חודשי" },
];

const mealMeta: Record<MealType, { title: string; icon: React.ReactNode }> = {
  breakfast: { title: "בוקר", icon: <span className="text-2xl">☕</span> },
  lunch: { title: "צהריים", icon: <span className="text-2xl">🍔</span> },
  dinner: { title: "ערב", icon: <span className="text-2xl">🥗</span> },
  snack: { title: "ביניים", icon: <span className="text-2xl">🍎</span> },
};

function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (value?.toDate && typeof value.toDate === "function") return value.toDate();

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
    if (match?.[1]) return Number(match[1]);
  }

  return 0;
}

function extractMacro(text = "", label: string) {
  const pattern = new RegExp(`${label}:\\s*(\\d+)`, "i");
  const match = text.match(pattern);
  return match?.[1] ? Number(match[1]) : 0;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDailyMeals(entries: MealEntry[], selectedDate: Date): Meal[] {
  const dayEntries = entries.filter((entry) =>
    isSameDay(entry.createdAt, selectedDate)
  );

  return (Object.keys(mealMeta) as MealType[]).map((mealType) => {
    const items = dayEntries.filter((entry) => entry.mealType === mealType);

    const calories = items.reduce(
      (sum, item) => sum + extractEstimatedCalories(item.analysisText || ""),
      0
    );
    const carbs = items.reduce(
      (sum, item) => sum + extractMacro(item.analysisText || "", "פחמימות"),
      0
    );
    const protein = items.reduce(
      (sum, item) => sum + extractMacro(item.analysisText || "", "חלבון"),
      0
    );
    const fat = items.reduce(
      (sum, item) => sum + extractMacro(item.analysisText || "", "שומן"),
      0
    );

    return {
      id: mealType,
      title: mealMeta[mealType].title,
      icon: mealMeta[mealType].icon,
      calories,
      carbs,
      protein,
      fat,
    };
  });
}

function buildDailyCalories(meals: Meal[]) {
  return meals.reduce((sum, meal) => sum + meal.calories, 0);
}

function getSelectedDate(activeTab: TabKey, periodIndex: number) {
  const baseDate = new Date();
  const date = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    12,
    0,
    0,
    0
  );

  if (activeTab === "daily") {
    date.setDate(date.getDate() + periodIndex);
    return date;
  }

  if (activeTab === "weekly") {
    date.setDate(date.getDate() + periodIndex * 7);
    return date;
  }

  date.setMonth(date.getMonth() + periodIndex);
  return date;
}

function buildWeeklyData(entries: MealEntry[], selectedDate: Date): PeriodData {
  const startOfWeek = new Date(selectedDate);
  const day = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - day);
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  const weekEntries = entries.filter((entry) => {
    const date = toDateSafe(entry.createdAt);
    return date && date >= startOfWeek && date <= endOfWeek;
  });

  const calories = weekEntries.reduce(
    (sum, item) => sum + extractEstimatedCalories(item.analysisText || ""),
    0
  );
  const carbs = weekEntries.reduce(
    (sum, item) => sum + extractMacro(item.analysisText || "", "פחמימות"),
    0
  );
  const protein = weekEntries.reduce(
    (sum, item) => sum + extractMacro(item.analysisText || "", "חלבון"),
    0
  );
  const fat = weekEntries.reduce(
    (sum, item) => sum + extractMacro(item.analysisText || "", "שומן"),
    0
  );

  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const current = new Date(startOfWeek);
    current.setDate(startOfWeek.getDate() + index);
    return current;
  });

  const chartPoints = weekDates.map((currentDate) => {
    return weekEntries
      .filter((entry) => isSameDay(entry.createdAt, currentDate))
      .reduce(
        (sum, item) => sum + extractEstimatedCalories(item.analysisText || ""),
        0
      );
  });

  const chartLabels = weekDates.map((date) => {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}`;
  });

  return {
    calories,
    carbs,
    protein,
    fat,
    chartPoints,
    chartLabels,
    chartTitle: "מבט שבועי",
  };
}

function buildMonthlyData(entries: MealEntry[], selectedDate: Date): PeriodData {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();

  const monthEntries = entries.filter((entry) => {
    const date = toDateSafe(entry.createdAt);
    return date && date.getFullYear() === year && date.getMonth() === month;
  });

  const calories = monthEntries.reduce(
    (sum, item) => sum + extractEstimatedCalories(item.analysisText || ""),
    0
  );
  const carbs = monthEntries.reduce(
    (sum, item) => sum + extractMacro(item.analysisText || "", "פחמימות"),
    0
  );
  const protein = monthEntries.reduce(
    (sum, item) => sum + extractMacro(item.analysisText || "", "חלבון"),
    0
  );
  const fat = monthEntries.reduce(
    (sum, item) => sum + extractMacro(item.analysisText || "", "שומן"),
    0
  );

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const chartPoints = Array.from({ length: daysInMonth }, () => 0);

  monthEntries.forEach((item) => {
    const date = toDateSafe(item.createdAt);
    if (!date) return;

    const dayIndex = date.getDate() - 1;
    chartPoints[dayIndex] =
      (chartPoints[dayIndex] ?? 0) +
      extractEstimatedCalories(item.analysisText || "");
  });

  const chartLabels = Array.from({ length: daysInMonth }, (_, index) =>
    String(index + 1)
  );

  return {
    calories,
    carbs,
    protein,
    fat,
    chartPoints,
    chartLabels,
    chartTitle: "מבט חודשי",
  };
}

function PeriodNavigator({
  title,
  onNext,
  onPrev,
}: {
  title: string;
  onNext: () => void;
  onPrev: () => void;
}) {
  return (
    <div className="flex bg-borange items-center justify-between px-4 py-3">
      <button type="button" onClick={onPrev}>
        <ChevronRight className="h-6 w-6 text-orange" />
      </button>

      <p className="text-xl font-bold text-orange text-center">{title}</p>

      <button type="button" onClick={onNext}>
        <ChevronLeft className="h-6 w-6 text-orange" />
      </button>
    </div>
  );
}

export default function NutritionJournalScreen() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.activeTab);
    if (saved === "daily" || saved === "weekly" || saved === "monthly") {
      return saved;
    }
    return "daily";
  });

  const [periodIndex, setPeriodIndex] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.periodIndex);
    if (saved === null) return 0;
    const parsed = Number(saved);
    return Number.isNaN(parsed) ? 0 : parsed;
  });

  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [loadingMeals, setLoadingMeals] = useState(true);
  const [mealsPermissionDenied, setMealsPermissionDenied] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.activeTab, activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.periodIndex, String(periodIndex));
  }, [periodIndex]);

  const loadMealsForUser = useCallback(async (userId: string) => {
    setLoadingMeals(true);

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
      setLoadingMeals(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;

      if (!user) {
        setEntries([]);
        setMealsPermissionDenied(false);
        setLoadingMeals(false);
        return;
      }

      await loadMealsForUser(user.uid);
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
    };
  }, [loadMealsForUser]);



  const selectedDate = useMemo(
    () => getSelectedDate(activeTab, periodIndex),
    [activeTab, periodIndex]
  );

  const currentData = useMemo(() => {
    if (activeTab === "daily") {
      const meals = buildDailyMeals(entries, selectedDate);
      return {
        calories: buildDailyCalories(meals),
        meals,
      };
    }

    if (activeTab === "weekly") {
      return buildWeeklyData(entries, selectedDate);
    }

    return buildMonthlyData(entries, selectedDate);
  }, [activeTab, entries, selectedDate]);

  const periodTitle = useMemo(() => {
    const baseDate = new Date(selectedDate);

    if (activeTab === "daily") {
      return baseDate.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    }

    if (activeTab === "weekly") {
      const day = baseDate.getDay();
      const startOfWeek = new Date(baseDate);
      startOfWeek.setDate(baseDate.getDate() - day);
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      const startStr = startOfWeek.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      const endStr = endOfWeek.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      return `${startStr} - ${endStr}`;
    }

    return baseDate.toLocaleDateString("he-IL", {
      month: "long",
      year: "numeric",
    });
  }, [activeTab, selectedDate]);

  return (
    <div dir="rtl" className="min-h-screen bg-cream">
    <ProfileDrawer
  isOpen={isDrawerOpen}
  onClose={() => setIsDrawerOpen(false)}
  userName={auth.currentUser?.displayName ?? undefined}
  userEmail={auth.currentUser?.email ?? undefined}
/>

      <div className="mx-auto flex min-h-screen w-full max-w-150 flex-col bg-cream pb-20">
        <Header onOpenMenu={() => setIsDrawerOpen(true)} />

        {mealsPermissionDenied && (
          <div className="mx-4 mt-3 rounded-2xl border border-orange/30 bg-white px-4 py-3 text-center text-sm font-semibold text-orange">
            אין הרשאה לטעון את הארוחות מהשרת כרגע. אפשר להמשיך להשתמש באפליקציה, ולנסות שוב לאחר התחברות מחדש.
          </div>
        )}

        <main className="flex-1">
          <TabSwitcher
            activeTab={activeTab}
            onChange={(tab) => {
              setActiveTab(tab);
              setPeriodIndex(0);
            }}
          />

          <PeriodNavigator
            title={periodTitle}
            onPrev={() => setPeriodIndex((prev) => prev - 1)}
            onNext={() => setPeriodIndex((prev) => prev + 1)}
          />

          <CaloriesCard calories={currentData.calories} />

          {loadingMeals ? (
            <div className="px-4 py-8 text-center text-lg text-placeholder">
              טוען ארוחות...
            </div>
          ) : activeTab === "daily" ? (
            <DailyView
              meals={currentData.meals ?? fallbackJournalData.daily.meals ?? []}
              onMealClick={(mealType) =>
                navigate(`/meal/${mealType}?date=${formatDateKey(selectedDate)}`)
              }
            />
          ) : (
            <StatsView
              carbs={currentData.carbs ?? 0}
              protein={currentData.protein ?? 0}
              fat={currentData.fat ?? 0}
              chartPoints={currentData.chartPoints ?? []}
              chartLabels={currentData.chartLabels ?? []}
              chartTitle={currentData.chartTitle ?? ""}
            />
          )}
        </main>

        <BottomNavbar />
      </div>
    </div>
  );
}

function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <header className="px-4 pt-10 pb-4">
      <div className="flex items-center justify-between border-b border-[#CFC9C1] pb-2">
        <button
          type="button"
          onClick={onOpenMenu}
          className="rounded-full p-2 text-orange transition hover:bg-orange/10"
          aria-label="פתחי תפריט"
        >
          <Menu className="h-7 w-7" />
        </button>

        <h1 className="text-2xl font-bold text-orange">יומן תזונה</h1>

        <div className="h-11 w-11" />
      </div>
    </header>
  );
}

function TabSwitcher({
  activeTab,
  onChange,
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  return (
    <div className="px-4 pb-4">
      <div className="grid grid-cols-3 rounded-full bg-gray p-1">
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange(tab.key)}
              className={`rounded-full py-2 text-lg font-semibold transition ${
                isActive
                  ? "bg-orange text-white shadow-sm"
                  : "text-orange-dark hover:bg-orange/10"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CaloriesCard({ calories }: { calories: number }) {
  return (
    <div className="bg-cream px-4 py-7">
      <div className="rounded-2xl bg-orange px-6 py-5 text-white shadow-sm">
        <div className="flex items-center justify-between text-2xl font-bold">
          <span>סטטוס קלוריות</span>
          <span>{calories} קל'</span>
        </div>
      </div>
    </div>
  );
}

function DailyView({
  meals,
  onMealClick,
}: {
  meals: Meal[];
  onMealClick: (mealType: MealType) => void;
}) {
  return (
    <section className="h-full px-4 py-6 bg-borange">
      <h2 className="mb-4 text-right text-2xl font-bold text-orange">
        הארוחות שלי
      </h2>

      <div className="space-y-4">
        {meals.map((meal) => (
          <MealCard
            key={meal.id}
            meal={meal}
            onClick={() => onMealClick(meal.id)}
          />
        ))}
      </div>
    </section>
  );
}

function MealCard({
  meal,
  onClick,
}: {
  meal: Meal;
  onClick: () => void;
}) {
  return (
    <div dir="rtl">
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-2xl bg-cream px-4 py-4 text-right shadow-sm transition hover:scale-[1.01]"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-orange">
            <div>{meal.icon}</div>
            <div className="text-right">
              <p className="text-3xl font-bold leading-none">{meal.title}</p>
              <p className="mt-2 text-xl font-medium">{meal.calories} קלוריות</p>
            </div>
          </div>

          <ChevronLeft className="h-5 w-5 text-orange" />
        </div>

        <div className="mt-3 border-t border-line pt-2 text-center text-sm font-medium text-placeholder sm:text-base">
          <span>פחמימות {meal.carbs} גרם</span>
          <span className="mx-2">|</span>
          <span>שומנים {meal.fat} גרם</span>
          <span className="mx-2">|</span>
          <span>חלבונים {meal.protein} גרם</span>
        </div>
      </button>
    </div>
  );
}

function StatsView({
  carbs,
  protein,
  fat,
  chartPoints,
  chartLabels,
  chartTitle,
}: {
  carbs: number;
  protein: number;
  fat: number;
  chartPoints: number[];
  chartLabels: string[];
  chartTitle: string;
}) {
  return (
    <section className="px-4 py-6 bg-borange">
      <div className="rounded-none bg-bcream px-4 py-5 shadow-sm">
        <div className="grid grid-cols-3 gap-2 text-center">
          <MacroStat title="פחמימות" value={carbs} />
          <MacroStat title="חלבונים" value={protein} />
          <MacroStat title="שומנים" value={fat} />
        </div>
      </div>

      <div className="mt-12 bg-bcream px-4 py-6 shadow-sm">
        <h3 className="mb-4 text-right text-2xl font-bold text-black">
          {chartTitle}
        </h3>
        <SimpleLineChart points={chartPoints} labels={chartLabels} />
      </div>
    </section>
  );
}

function MacroStat({ title, value }: { title: string; value: number }) {
  return (
    <div>
      <p className="text-l font-semibold text-black sm:text-sm">(גרם)</p>
      <p className="text-xl font-bold text-orange">{title}</p>
      <p className="mt-1 text-xl font-bold text-black">{value}</p>
    </div>
  );
}

function SimpleLineChart({
  points,
  labels,
}: {
  points: number[];
  labels: string[];
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = Math.max(320, points.length * 24);
  const height = 170;
  const paddingLeft = 24;
  const paddingRight = 14;
  const paddingTop = 14;
  const paddingBottom = 34;
  const maxPoint = Math.max(...points, 1);
  const minPoint = Math.min(...points, 0);
  const range = Math.max(maxPoint - minPoint, 1);

  const pointCoordinates = points.map((point, index) => {
    const x =
      paddingLeft +
      (index * (width - paddingLeft - paddingRight)) /
        Math.max(points.length - 1, 1);
    const y =
      height -
      paddingBottom -
      ((point - minPoint) / range) * (height - paddingTop - paddingBottom);

    return {
      index,
      x,
      y,
      value: point,
      label: labels[index] ?? String(index + 1),
    };
  });

  const coordinates = pointCoordinates.map((point) => `${point.x},${point.y}`).join(" ");

  const labelStep = points.length <= 8 ? 1 : Math.ceil(points.length / 8);
  const hoveredPoint =
    hoveredIndex !== null ? pointCoordinates[hoveredIndex] ?? null : null;
  const tooltipText = hoveredPoint
    ? `${hoveredPoint.label}: ${hoveredPoint.value} קל׳`
    : "";
  const tooltipWidth = Math.max(78, tooltipText.length * 6.2 + 12);
  const tooltipHeight = 20;
  const tooltipX = hoveredPoint
    ? Math.min(
        Math.max(hoveredPoint.x - tooltipWidth / 2, paddingLeft),
        width - paddingRight - tooltipWidth
      )
    : 0;
  const tooltipY = hoveredPoint
    ? Math.max(hoveredPoint.y - 12 - tooltipHeight, paddingTop)
    : 0;

  return (
    <div className="w-full overflow-x-auto" onMouseLeave={() => setHoveredIndex(null)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto min-w-[320px] w-full"
      >
        <line
          x1={paddingLeft}
          y1={paddingTop}
          x2={paddingLeft}
          y2={height - paddingBottom}
          stroke="#333333"
          strokeWidth="1.8"
        />
        <line
          x1={paddingLeft}
          y1={height - paddingBottom}
          x2={width - paddingRight}
          y2={height - paddingBottom}
          stroke="#333333"
          strokeWidth="1.8"
        />
        <polyline
          fill="none"
          stroke="var(--color-orange)"
          strokeWidth="2.2"
          points={coordinates}
        />

        {hoveredPoint && (
          <g>
            <line
              x1={hoveredPoint.x}
              y1={paddingTop}
              x2={hoveredPoint.x}
              y2={height - paddingBottom}
              stroke="#9F8D7F"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <rect
              x={tooltipX}
              y={tooltipY}
              width={tooltipWidth}
              height={tooltipHeight}
              rx="6"
              fill="#2F2F2F"
            />
            <text
              x={tooltipX + tooltipWidth / 2}
              y={tooltipY + 13}
              textAnchor="middle"
              fontSize="10"
              fill="#FFFFFF"
            >
              {tooltipText}
            </text>
          </g>
        )}

        {pointCoordinates.map((point) => {
          const shouldShowLabel =
            point.index % labelStep === 0 || point.index === points.length - 1;

          return (
            <g
              key={`chart-point-${point.index}`}
              onMouseEnter={() => setHoveredIndex(point.index)}
              onClick={() =>
                setHoveredIndex((current) =>
                  current === point.index ? null : point.index
                )
              }
            >
              <circle
                cx={point.x}
                cy={point.y}
                r={hoveredIndex === point.index ? "4" : "3"}
                fill="var(--color-orange)"
              />
              {shouldShowLabel && (
                <text
                  x={point.x}
                  y={height - 10}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#4B4B4B"
                >
                  {point.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
function BottomNavbar() {
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-150 -translate-x-1/2 border-t border-line bg-cream shadow-[0_-3px_14px_rgba(0,0,0,0.08)]">
      <div className="relative flex h-20 items-center justify-around px-4">
        <button
          type="button"
          aria-label="הוספה חדשה"
          onClick={() => navigate("/my-meals")}
          className="absolute -top-16 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-orange text-white shadow-lg hover:bg-orange/80 active:scale-95"
        >
          <Plus className="h-7 w-7" />
        </button>

        <button
          onClick={() => openWhatsAppChat()}
          className="flex flex-col items-center gap-1 text-placeholder"
        >
          <MdOutlineWhatsapp className="h-7 w-7" />
          <span className="text-sm">WhatsApp</span>
        </button>

        <button
          onClick={() => navigate("/favorites")}
          className="flex flex-col items-center gap-1 text-placeholder"
        >
          <Heart className="h-7 w-7" />
          <span className="text-sm">מועדפים</span>
        </button>

        <button className="flex flex-col items-center gap-1 text-orange">
          <CalendarDays className="h-7 w-7" />
          <span className="text-sm">יומן</span>
        </button>

        <button className="flex flex-col items-center gap-1 text-placeholder">
          <BsChatLeftDots className="h-7 w-7" />
          <span className="text-sm">הצ'אט שלי</span>
        </button>
      </div>
    </nav>
  );
}