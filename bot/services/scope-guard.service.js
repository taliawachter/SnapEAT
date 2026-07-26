const OUT_OF_SCOPE_REPLY_HEBREW = "אני יכולה לעזור רק בנושאי מזון, תזונה ומעקב ארוחות ב-SNAP EAT. אפשר לשאול אותי על ארוחות, קלוריות, חלבון, פחמימות, שומן, מוצרים או מתכונים.";
const GREETING_REPLY_HEBREW = "היי! 😊\nאני SNAP EAT, העוזרת שלך לכל מה שקשור למזון, תזונה ומעקב ארוחות.\n\nאפשר לשאול אותי על:\n🥗 ניתוח ארוחות\n🍎 קלוריות וערכים תזונתיים\n💪 חלבון, פחמימות ושומן\n📦 מוצרים וברקודים\n📖 מתכונים\n❤️ הארוחות השמורות שלך";

const GREETING_TERMS = [
  "היי",
  "הי",
  "שלום",
  "בוקר טוב",
  "צהריים טובים",
  "ערב טוב",
  "לילה טוב",
  "מה קורה",
  "מה נשמע",
  "הלו",
  "הייי",
];

const ALLOWED_SCOPE_TERMS = [
  "ארוחה",
  "ארוחות",
  "אוכל",
  "אכילה",
  "אכלתי",
  "אכל",
  "מזון",
  "מאכל",
  "מזונות",
  "מוצר",
  "מוצרים",
  "קלוריות",
  "קלוריה",
  "חלבון",
  "פחמימות",
  "שומן",
  "תזונה",
  "דיאטה",
  "תפריט",
  "מתכון",
  "מתכונים",
  "רכיב",
  "רכיבים",
  "מרכיב",
  "מרכיבים",
  "אלרגי",
  "אלרגיה",
  "רגישות",
  "מגבלה",
  "הגבלה",
  "העדפה",
  "העדפות",
  "משקל",
  "מטרת",
  "מטרות",
  "ירידה",
  "עלייה",
  "שמור",
  "שמירה",
  "שמרתי",
  "יומן",
  "מועדף",
  "מועדפים",
  "הוסף",
  "הוספה",
  "הסר",
  "הסרה",
  "מחק",
  "מחיקה",
  "למחוק",
  "להסיר",
  "לשמור",
  "לערוך",
  "לאכול",
  "ברקוד",
  "סרק",
  "סרקתי",
  "תנתח",
  "ניתוח",
  "אריזה",
  "חצי",
  "רבע",
  "analysis",
  "nutrition",
  "calorie",
  "calories",
  "protein",
  "carb",
  "carbs",
  "carbohydrate",
  "carbohydrates",
  "fat",
  "food",
  "meal",
  "recipe",
  "recipes",
  "ingredient",
  "ingredients",
  "allergy",
  "allergies",
  "diet",
  "favorite",
  "favorites",
  "history",
  "snapeat",
  "snap eat",
  "app",
  "tracker",
  "tracking",
  "diary",
];

const NUTRITION_ADVICE_PATTERNS = [
  /מה\s+כדאי\s+לאכול/u,
  /מה\s+לאכול/u,
  /מה\s+אני\s+צריכה\s+לאכול/u,
  /מה\s+אני\s+צריך\s+לאכול/u,
  /תעשה\s+לי\s+תפריט/u,
  /תבנה\s+לי\s+תפריט/u,
  /איך\s+לרדת\s+במשקל/u,
  /איך\s+לעלות\s+במשקל/u,
  /איך\s+לבנות\s+מסת\s+שריר/u,
  /לבנות\s+מסת\s+שריר/u,
  /לבנות\s+שריר/u,
  /כמה\s+ארוחות\s+כדאי\s+לאכול/u,
  /לאכול\s+בבוקר/u,
  /לאכול\s+בערב/u,
  /לאכול\s+אחרי\s+אימון/u,
  /לרדת\s+במשקל/u,
  /לעלות\s+במשקל/u,
  /מסת\s+שריר/u,
  /תפריט\s+מתאים/u,
  /מספיק\s+לאכול/u,
  /מה\s+לאכול\s+ל/u,
];

const BLOCKLIST_TERMS = [
  "טיול",
  "טיולים",
  "יעד",
  "יעדי",
  "מלון",
  "מלונות",
  "טיסה",
  "טיסות",
  "תיק",
  "תיקים",
  "בגדים",
  "בגד",
  "קניות",
  "לקנות",
  "shopping",
  "bag",
  "backpack",
  "travel",
  "tour",
  "hotel",
  "flight",
  "clothes",
  "shirt",
  "dress",
  "shoes",
  "computer",
  "מחשב",
  "טלפון",
  "אייפון",
  "אלקטרוניקה",
  "technology",
  "programming",
  "javascript",
  "python",
  "code",
  "software",
  "politics",
  "פוליטיקה",
  "משחק",
  "סרט",
  "סדרה",
  "ספורט",
  "לימודים",
  "ללמוד",
  "school",
  "study",
  "studies",
  "movie",
  "song",
  "game",
  "sport",
];

export function normalizeScopeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u200b-\u200d\u00a0]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGreetingMessage(text = "") {
  const normalizedText = normalizeScopeText(text);
  if (!normalizedText) {
    return false;
  }

  return GREETING_TERMS.some((term) => normalizedText === term || normalizedText.includes(term));
}

export function getGreetingReply() {
  return GREETING_REPLY_HEBREW;
}

// Blocklist terms are matched whole-word (not substring) because several are
// short Hebrew roots that also occur inside unrelated words, and some are
// outright homographs with food terms (e.g. "מלון" means both "hotel" and
// "melon"). Multi-word blocklist phrases still match as a contiguous phrase.
function matchesBlocklistTerm(normalizedText) {
  const words = normalizedText.split(" ");
  return (
    BLOCKLIST_TERMS.find((term) =>
      term.includes(" ") ? normalizedText.includes(term) : words.includes(term)
    ) || null
  );
}

function matchesAllowedTerm(normalizedText) {
  return ALLOWED_SCOPE_TERMS.find((term) => normalizedText.includes(term)) || null;
}

function matchesAdvicePattern(normalizedText) {
  return NUTRITION_ADVICE_PATTERNS.find((pattern) => pattern.test(normalizedText)) || null;
}

export function isNutritionRelatedMessage(text, pendingState = null) {
  const pendingStep = typeof pendingState?.step === "string" ? pendingState.step.trim() : "";
  if (pendingStep) {
    return true;
  }

  const normalizedText = normalizeScopeText(text);
  if (!normalizedText) {
    return false;
  }

  // Explicit nutrition/meal-planning intent wins over the blocklist: a
  // message that clearly asks about food/meals/nutrition should never be
  // rejected just because it also contains an unrelated (or homograph)
  // blocklist word, e.g. "אכלתי מלון היום" ("I ate melon today").
  if (matchesAllowedTerm(normalizedText) || matchesAdvicePattern(normalizedText)) {
    return true;
  }

  if (matchesBlocklistTerm(normalizedText)) {
    return false;
  }

  return false;
}

// Test/diagnostic helper only — not used by any production code path.
// Exposes which rule decided the classification so behavior can be verified
// directly instead of by re-deriving it from the boolean result.
export function debugNutritionScopeDecision(text, pendingState = null) {
  const pendingStep = typeof pendingState?.step === "string" ? pendingState.step.trim() : "";
  const normalizedText = normalizeScopeText(text);

  if (pendingStep) {
    return {
      pendingStep,
      normalizedText,
      allowedMatch: null,
      advicePatternMatch: null,
      blocklistMatch: null,
      decidedBy: "pending_flow",
      result: true,
    };
  }

  if (!normalizedText) {
    return {
      pendingStep: null,
      normalizedText,
      allowedMatch: null,
      advicePatternMatch: null,
      blocklistMatch: null,
      decidedBy: "empty_text",
      result: false,
    };
  }

  const allowedMatch = matchesAllowedTerm(normalizedText);
  const advicePattern = matchesAdvicePattern(normalizedText);
  const blocklistMatch = matchesBlocklistTerm(normalizedText);

  let decidedBy;
  let result;
  if (allowedMatch) {
    decidedBy = "allowed_term";
    result = true;
  } else if (advicePattern) {
    decidedBy = "advice_pattern";
    result = true;
  } else if (blocklistMatch) {
    decidedBy = "blocklist_term";
    result = false;
  } else {
    decidedBy = "no_match";
    result = false;
  }

  return {
    pendingStep: null,
    normalizedText,
    allowedMatch,
    advicePatternMatch: advicePattern ? advicePattern.toString() : null,
    blocklistMatch,
    decidedBy,
    result,
  };
}

export function getOutOfScopeReply() {
  return OUT_OF_SCOPE_REPLY_HEBREW;
}

export async function getScopedAssistantReply({ userText, pendingState = null, generateReplyFn }) {
  const pendingStep = typeof pendingState?.step === "string" ? pendingState.step.trim() : "";
  if (!pendingStep && isGreetingMessage(userText)) {
    return {
      reply: getGreetingReply(),
      shouldCallOpenAI: false,
    };
  }

  if (!isNutritionRelatedMessage(userText, pendingState)) {
    return {
      reply: getOutOfScopeReply(),
      shouldCallOpenAI: false,
    };
  }

  const reply = await generateReplyFn();
  return {
    reply,
    shouldCallOpenAI: true,
  };
}
