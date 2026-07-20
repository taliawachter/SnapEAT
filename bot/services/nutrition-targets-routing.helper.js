// Deterministic (non-LLM) detection of "how much should I eat" style
// requests — daily calorie targets, daily protein targets, or weight-loss/
// weight-gain calorie requests. These are answered by the deterministic
// nutrition-targets.service.js calculator, NOT by RAG/file_search, because
// they require a personal numeric answer that a knowledge-base citation can
// never ground (see bot/services/nutrition-knowledge.service.js — a
// citation-less numeric claim is always suppressed there by design).
//
// This module only classifies intent. It never touches Firestore, OpenAI,
// or performs any calculation itself.

const PROTEIN_KEYWORDS = ["חלבון", "protein"];
const CALORIE_KEYWORDS = ["קלוריות", "קלורי", "calorie", "calories"];

// Phrases that signal "how much do I personally need", as opposed to a
// general knowledge question like "מה מקורות טובים לחלבון?" (that one has
// no personal-target signal and should keep going through the normal RAG
// flow).
const PERSONAL_TARGET_SIGNAL_PATTERNS = [
  /כמה .{0,24}(אני|לי|צריכ|כדאי)/, // "כמה חלבון אני צריכה", "כמה כדאי לי לאכול", "כמה קלוריות וחלבון אני צריכה"
  /כמה (לאכול|קלוריות|חלבון) ביום/,
  /(קלוריות|חלבון) ביום/,
  /(יעד|צריכה?|צורך) (יומי|קלורי|חלבון)/,
  /how (much|many) .{0,20}(calories|protein|should i (eat|consume))/i,
  /(daily|per day) .{0,15}(calories|protein)/i,
  /weight loss calories/i,
  /calories? (for|to) (lose|gain) weight/i,
];

// A weight-loss/weight-gain statement combined with a calorie/food-amount
// question, e.g. "אני רוצה לרדת במשקל, כמה קלוריות לאכול?" — the goal
// phrase itself doesn't mention "קלוריות", so it needs its own pattern.
const GOAL_PLUS_QUANTITY_PATTERNS = [
  /(לרדת|לרזות|ירידה) במשקל.{0,40}(כמה|קלורי)/,
  /(לעלות|עלייה) במשקל.{0,40}(כמה|קלורי)/,
  /weight loss.{0,40}calories?/i,
  /lose weight.{0,40}(calories?|eat)/i,
];

// A BARE first-person statement of wanting to lose/gain/maintain weight —
// e.g. just "אני רוצה לרדת במשקל" with no quantity word anywhere in the
// message — is itself treated as an implicit request for a personal
// calorie target. Without this, such a message doesn't match any pattern
// above, falls through this router entirely, and lands in the general
// unconstrained chat flow — which has no knowledge of this app's
// required fields and, in practice, has improvised its own unwanted
// questions (including about age). Catching the goal declaration here is
// what lets bot/index.js's nutrition-target flow take over immediately
// and ask only for the real missing fields (weight/height/activity/sex —
// never age).
const GOAL_DECLARATION_PATTERNS = [
  /אני (רוצה|מעוניינת|מעוניין).{0,10}(לרדת|לרזות|להוריד).{0,10}משקל/,
  /אני (רוצה|מעוניינת|מעוניין).{0,10}(לעלות|להעלות).{0,10}(משקל|מסה)/,
  /אני (רוצה|מעוניינת|מעוניין).{0,10}לשמור על.{0,10}משקל/,
  /i want to (lose|gain) weight/i,
  /i (want|need) to maintain (my )?weight/i,
];

function normalize(text = "") {
  return String(text || "").trim().toLowerCase();
}

function matchesAny(input, patterns) {
  return patterns.some((pattern) => pattern.test(input));
}

function includesAny(input, words) {
  return words.some((word) => input.includes(word));
}

/**
 * @param {string} text
 * @returns {{
 *   isNutritionTargetRequest: boolean,
 *   requestType: "calories" | "protein" | "both" | null,
 * }}
 */
export function detectNutritionTargetRequest(text = "") {
  const input = normalize(text);

  if (!input) {
    return { isNutritionTargetRequest: false, requestType: null };
  }

  const hasPersonalSignal =
    matchesAny(input, PERSONAL_TARGET_SIGNAL_PATTERNS) ||
    matchesAny(input, GOAL_PLUS_QUANTITY_PATTERNS) ||
    matchesAny(input, GOAL_DECLARATION_PATTERNS);

  if (!hasPersonalSignal) {
    return { isNutritionTargetRequest: false, requestType: null };
  }

  const mentionsProtein = includesAny(input, PROTEIN_KEYWORDS);
  const mentionsCalories = includesAny(input, CALORIE_KEYWORDS);

  if (mentionsProtein && mentionsCalories) {
    return { isNutritionTargetRequest: true, requestType: "both" };
  }

  if (mentionsProtein) {
    return { isNutritionTargetRequest: true, requestType: "protein" };
  }

  // "כמה לאכול ביום", "weight loss calories", a goal+quantity phrase with no
  // explicit macro word, etc. all default to a calorie target — the most
  // natural reading of an unqualified "how much should I eat" question.
  return { isNutritionTargetRequest: true, requestType: "calories" };
}

export function isNutritionTargetRequest(text = "") {
  return detectNutritionTargetRequest(text).isNutritionTargetRequest;
}
