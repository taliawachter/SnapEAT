const HEBREW_KEYWORDS = [
  "ארוחה מאוזנת",
  "חלבון",
  "פחמימות",
  "פחמימה",
  "שומן",
  "שומנים",
  "מים",
  "הידרציה",
  "ירידה במשקל",
  "לרדת במשקל",
  "תזונה",
  "בריא",
  "קלור",
  "מאקרו",
  "סיבים",
];

const ENGLISH_KEYWORDS = [
  "balanced meal",
  "protein sources",
  "carbohydrate",
  "carb",
  "fat intake",
  "hydration",
  "lose weight",
  "weight loss",
  "nutrition",
  "calories",
  "macros",
  "fiber",
];

const SMALL_TALK_PATTERNS = [
  /^היי[!?.\s]*$/i,
  /^שלום[!?.\s]*$/i,
  /^מה נשמע[?!.\s]*$/i,
  /^hi[!?.\s]*$/i,
  /^hello[!?.\s]*$/i,
  /^hey[!?.\s]*$/i,
  /^thanks?[!?.\s]*$/i,
  /^תודה[!?.\s]*$/i,
];

export function isGeneralNutritionQuestion(text = "") {
  const input = String(text || "").trim().toLowerCase();
  if (!input) return false;

  if (SMALL_TALK_PATTERNS.some((pattern) => pattern.test(input))) {
    return false;
  }

  const hasQuestionSignal = input.includes("?") || input.includes("איך") || input.includes("מה") || input.includes("למה");
  const matchesKeyword = HEBREW_KEYWORDS.some((k) => input.includes(k))
    || ENGLISH_KEYWORDS.some((k) => input.includes(k));

  return matchesKeyword && hasQuestionSignal;
}
