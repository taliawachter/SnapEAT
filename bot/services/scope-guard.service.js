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

function normalizeScopeText(value = "") {
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

export function isNutritionRelatedMessage(text, pendingState = null) {
  const pendingStep = typeof pendingState?.step === "string" ? pendingState.step.trim() : "";
  if (pendingStep) {
    return true;
  }

  const normalizedText = normalizeScopeText(text);
  if (!normalizedText) {
    return false;
  }

  const hasBlocklistTerm = BLOCKLIST_TERMS.some((term) => normalizedText.includes(term));
  if (hasBlocklistTerm) {
    return false;
  }

  const hasAllowedTerm = ALLOWED_SCOPE_TERMS.some((term) => normalizedText.includes(term));
  if (hasAllowedTerm) {
    return true;
  }

  return false;
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
