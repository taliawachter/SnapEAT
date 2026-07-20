// Deterministic nutrition target calculations: daily calorie targets and a
// general daily protein estimate. No language model is involved in any
// arithmetic here — see bot/services/nutrition-instructions.js, which
// instructs the assistant to relay these structured results verbatim and
// never compute or invent numbers itself.
//
// This module is intentionally pure (no Firestore, no OpenAI, no WhatsApp).
// Profile gathering (merging web onboarding data with bot-collected memory)
// and the multi-turn "ask only what's missing" conversation live in
// bot/index.js, which calls into this module with a plain profile object.

// Age is intentionally NOT collected from the user during the normal
// calorie/protein flow, and plays no role anywhere in this module (see
// bot/index.js's nutrition-target orchestration). REQUIRED_CALORIE_FIELDS
// therefore does not include "age" — the field order here also drives the
// order fields are asked in: weight, height, activity, sex, goal.
export const REQUIRED_CALORIE_FIELDS = ["weightKg", "heightCm", "activityLevel", "sex", "goal"];
export const REQUIRED_PROTEIN_FIELDS = ["weightKg"];

// Four deterministic activity tiers (not five) — see normalizeActivityLevel
// for the exact classification rules. A specific workout frequency (e.g.
// "3 פעמים בשבוע") is always a stronger signal than a vague adjective, and
// is checked first, precisely so that "מתאמנת 3 פעמים בשבוע" (3x/week)
// lands on moderately_active rather than being over-classified as high/very
// active — that misclassification was a real reported bug.
export const ACTIVITY_LEVELS = ["sedentary", "lightly_active", "moderately_active", "very_active"];
export const GOALS = ["lose", "maintain", "gain"];

// A technical estimate used ONLY inside the Mifflin-St Jeor formula when no
// real age is known. It is never asked of the user, never shown as "your
// age", and never written to the user's stored profile — see
// resolveEffectiveAge() and calculateMaintenanceCalories()'s
// `ageSource`/`calculationAgeUsed` metadata fields.
export const DEFAULT_CALCULATION_AGE = 30;

// Moderate, configurable, flat calorie adjustments (not a percentage) —
// e.g. maintenance 1850 -> weight-loss target 1550 with the default value.
export const DEFAULT_WEIGHT_LOSS_DEFICIT = 300;
export const DEFAULT_WEIGHT_GAIN_SURPLUS = 300;

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
};

// Full label, used inline in calculation replies ("...ו<label>...").
const ACTIVITY_LEVEL_LABEL_HEBREW = {
  sedentary: "רמת פעילות נמוכה",
  lightly_active: "רמת פעילות נמוכה",
  moderately_active: "רמת פעילות בינונית",
  very_active: "רמת פעילות גבוהה",
};

// Short label (no "רמת פעילות" prefix), used for standalone confirmations
// like "עדכנתי: רמת פעילות - בינונית".
export const ACTIVITY_LEVEL_SHORT_LABEL_HEBREW = {
  sedentary: "נמוכה",
  lightly_active: "נמוכה",
  moderately_active: "בינונית",
  very_active: "גבוהה",
};

// Used in the calorie reply's "• מטרה: ..." bullet.
const GOAL_LABEL_HEBREW = {
  lose: "ירידה במשקל",
  maintain: "שמירה על המשקל",
  gain: "עלייה במשקל",
};

// Safety floor: never present a "general estimate" below this, regardless
// of the math, to avoid the app itself nudging someone toward an unsafely
// low intake.
const MIN_SAFE_CALORIE_TARGET = 1200;

// sedentary / lightly_active -> a single baseline value.
const PROTEIN_PER_KG_BASELINE = 0.8;
// moderately_active -> a range, not the baseline (see calculateProteinEstimate).
const PROTEIN_PER_KG_MODERATE_LOW = 1.2;
const PROTEIN_PER_KG_MODERATE_HIGH = 1.6;
// very_active -> a higher range.
const PROTEIN_PER_KG_VERY_ACTIVE_LOW = 1.6;
const PROTEIN_PER_KG_VERY_ACTIVE_HIGH = 2.2;

const MIN_PLAUSIBLE_AGE = 1;
const MAX_PLAUSIBLE_AGE = 120;
const MIN_PLAUSIBLE_HEIGHT_CM = 50;
const MAX_PLAUSIBLE_HEIGHT_CM = 250;
const MIN_PLAUSIBLE_WEIGHT_KG = 20;
const MAX_PLAUSIBLE_WEIGHT_KG = 300;

// Age plays NO role in safety blocking — there is no minor/under-18 check
// anywhere in this module. Only these five explicit medical/life-stage
// conditions ever block a calculation; age is never part of that list, and
// is never asked about, inferred, or mentioned in any conversation step.
const UNSAFE_BLOCK_MESSAGES_HEBREW = {
  pregnancy: "בהריון הצרכים התזונתיים משתנים ודורשים התאמה אישית. מומלץ להתייעץ עם רופא/ה או דיאטנית.",
  breastfeeding: "בתקופת הנקה הצרכים התזונתיים משתנים ודורשים התאמה אישית. מומלץ להתייעץ עם רופא/ה או דיאטנית.",
  kidneyDisease: "במחלת כליות יש להתאים תזונה בליווי רפואי. מומלץ להתייעץ עם רופא/ה או דיאטנית.",
  liverDisease: "במחלת כבד יש להתאים תזונה בליווי רפואי. מומלץ להתייעץ עם רופא/ה או דיאטנית.",
  eatingDisorder:
    "בהיסטוריה או במצב נוכחי של הפרעת אכילה, אומדנים מספריים עלולים להזיק. מומלץ לפנות לאיש/אשת מקצוע מוסמכ/ת לתמיכה.",
};

const UNSAFE_KEYWORDS = {
  pregnancy: ["בהריון", "הריון", "הריונית", "pregnant", "pregnancy"],
  breastfeeding: ["מניקה", "הנקה", "מיניקה", "breastfeeding", "nursing", "lactating"],
  // Deliberately NOT matching bare "כליות"/"כבד" — "כבד" also means "heavy"
  // in Hebrew (e.g. "אימון כבד" = "heavy workout"), and a bare organ name
  // is too weak a signal on its own; only specific disease phrasing counts.
  kidneyDisease: [
    "מחלת כליה",
    "מחלת כליות",
    "אי ספיקת כליות",
    "אי ספיקה כלייתית",
    "כשל כלייתי",
    "קוצר כלייתי",
    "דיאליזה",
    "kidney disease",
    "kidney failure",
    "renal disease",
    "renal failure",
    "dialysis",
  ],
  liverDisease: [
    "מחלת כבד",
    "שחמת הכבד",
    "שחמת",
    "כבד שומני",
    "אי ספיקת כבד",
    "liver disease",
    "cirrhosis",
    "hepatitis",
    "fatty liver",
    "liver failure",
  ],
  eatingDisorder: [
    "הפרעת אכילה",
    "אנורקסיה",
    "בולימיה",
    "הפרעות אכילה",
    "eating disorder",
    "anorexia",
    "bulimia",
    "binge eating",
  ],
};

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function normalizeSex(value) {
  const text = normalizeText(value);
  if (["male", "m", "זכר", "גבר", "בן"].includes(text)) return "male";
  if (["female", "f", "נקבה", "אישה", "אשה", "בת"].includes(text)) return "female";
  return null;
}

// Extracts an explicit "N times a week" / "N times per week" workout
// frequency, in either Hebrew or English, plus "every day"/"כל יום" as 7.
// A specific number is always a stronger, less ambiguous signal than any
// adjective, so it's checked first in normalizeActivityLevel below.
function extractWorkoutsPerWeek(text) {
  // "פעמיים בשבוע" (twice a week) must be checked before the bare "פעם"
  // check below, since "פעמיים" itself contains "פעם" as a prefix.
  if (/פעמיים\s*(?:ב)?שבוע/.test(text)) return 2;
  if (/(?:^|\s)פעם\s*(?:ב)?שבוע/.test(text)) return 1;

  const hebrewMatch = text.match(/(\d)\s*(?:פעמים|פעם)\s*(?:ב)?שבוע/);
  if (hebrewMatch) {
    const n = Number(hebrewMatch[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 7) return n;
  }

  const englishMatch = text.match(/(\d)\s*(?:times?|x)\s*(?:a|per)\s*week/i);
  if (englishMatch) {
    const n = Number(englishMatch[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 7) return n;
  }

  if (/כל יום|יום ?יום|יומיומ|every ?day|daily/.test(text)) return 7;

  return null;
}

/**
 * Four deterministic tiers, classified in this priority order:
 *   1. explicit "no exercise" phrasing -> sedentary
 *   2. an explicit workout frequency (the strongest, least ambiguous
 *      signal) -> bucketed by count: 0 sedentary, 1-2 lightly_active,
 *      3-5 moderately_active, 6-7 very_active
 *   3. explicit high-intensity/competitive/professional phrasing -> very_active
 *   4. an explicit "בינונית"/moderate phrase -> moderately_active
 *   5. an explicit "קלה"/"נמוכה"/light phrase -> lightly_active
 *   6. a vague, generic mention of exercising at all (e.g. just
 *      "מתאמנת"/"אימונים" with no frequency or intensity given) ->
 *      moderately_active as the safer, non-over-classifying default —
 *      this is what previously over-classified "מתאמנת 3 פעמים בשבוע"
 *      style answers as "active"/"very_active".
 *
 * Never matches a bare "פעיל" substring — that string is also the prefix
 * of "פעילות" (the generic Hebrew word for "activity" itself), so a bare
 * "פעיל" keyword would match almost any answer to "what's your activity
 * level" and was a real source of misclassification bugs.
 */
export function normalizeActivityLevel(value) {
  const text = normalizeText(value);
  if (!text) return null;

  if (
    [
      "sedentary",
      "יושבני",
      "יושבנית",
      "לא פעיל",
      "לא פעילה",
      "ללא פעילות",
      "אין פעילות",
      "לא מתאמנת",
      "לא מתאמן",
      "כמעט לא מתאמנת",
      "כמעט לא מתאמן",
      "בעיקר יושבת",
      "בעיקר יושב",
    ].some((w) => text.includes(w))
  ) {
    return "sedentary";
  }

  const perWeek = extractWorkoutsPerWeek(text);
  if (perWeek !== null) {
    if (perWeek <= 0) return "sedentary";
    if (perWeek <= 2) return "lightly_active";
    if (perWeek <= 5) return "moderately_active";
    return "very_active"; // 6-7
  }

  if (
    [
      "very_active",
      "very active",
      "גבוהה מאוד",
      "אינטנסיבית מאוד",
      "אינטנסיבי מאוד",
      "ספורטאי תחרותי",
      "ספורטאית תחרותית",
      "אימונים מקצועיים",
      "עבודה פיזית קשה",
      "גבוהה",
    ].some((w) => text.includes(w))
  ) {
    return "very_active";
  }

  if (["moderate", "moderately_active", "בינונית", "פעילות בינונית"].some((w) => text.includes(w))) {
    return "moderately_active";
  }

  if (["light", "lightly_active", "קלה", "פעילות קלה", "מעט פעילות", "נמוכה"].some((w) => text.includes(w))) {
    return "lightly_active";
  }

  // Generic, frequency-less mention of exercising at all — safest default
  // is moderate, not high/very-active.
  if (["אימונים", "מתאמנת", "מתאמן", "פעילה", "מתאמנת בקביעות", "מתאמן בקביעות"].some((w) => text.includes(w))) {
    return "moderately_active";
  }

  return null;
}

export function normalizeGoal(value) {
  const text = normalizeText(value);
  if (!text) return null;

  if (["lose", "ירידה", "לרדת", "לרזות", "להוריד משקל", "weight loss", "lose weight"].some((w) => text.includes(w))) {
    return "lose";
  }
  if (["gain", "עלייה", "לעלות", "עלייה במסה", "gain weight"].some((w) => text.includes(w))) {
    return "gain";
  }
  if (["maintain", "שמירה", "לשמור", "ייצוב", "יציבות", "maintain weight"].some((w) => text.includes(w))) {
    return "maintain";
  }

  return null;
}

/**
 * Deterministic keyword scan for the explicit medical/life-stage
 * conditions that must block a numeric estimate outright: pregnancy,
 * breastfeeding, kidney disease, liver disease, eating disorder. Never an
 * LLM call.
 *
 * Deliberately does NOT take age into account in any way. There is no
 * minor/under-18 check here or anywhere else in this module — age is
 * never asked, never inferred, and never a basis for blocking a
 * calculation. `age` is accepted as a parameter only for backward
 * compatibility with existing callers; it is intentionally unused.
 */
export function detectUnsafeConditions({ freeText = "" } = {}) {
  const reasons = [];

  const text = normalizeText(freeText);
  if (text) {
    for (const [reason, keywords] of Object.entries(UNSAFE_KEYWORDS)) {
      if (keywords.some((keyword) => text.includes(normalizeText(keyword)))) {
        reasons.push(reason);
      }
    }
  }

  return Array.from(new Set(reasons));
}

const GENERIC_SAFETY_FALLBACK_HEBREW = "מומלץ להתייעץ עם רופא/ה או דיאטנית לפני חישוב מסוג זה במצב הזה.";

export function getUnsafeConditionMessage(reasons = []) {
  const first = reasons.find((reason) => UNSAFE_BLOCK_MESSAGES_HEBREW[reason]);
  return UNSAFE_BLOCK_MESSAGES_HEBREW[first] || GENERIC_SAFETY_FALLBACK_HEBREW;
}

function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function getMissingFields(profile = {}, requiredFields = REQUIRED_CALORIE_FIELDS) {
  return requiredFields.filter((field) => !isPresent(profile?.[field]));
}

// Age is deliberately absent from this list — it is never asked, in any
// wording, under any circumstance.
const FIELD_QUESTIONS_HEBREW = {
  weightKg: "מה המשקל שלך?",
  heightCm: "מה הגובה שלך?",
  activityLevel: "מה רמת הפעילות שלך?",
  sex: "האם את אישה או גבר?",
  goal: "האם המטרה היא ירידה, שמירה או עלייה במשקל?",
};

const REQUEST_TYPE_LABEL_HEBREW = {
  calories: "יעד קלורי",
  protein: "אומדן חלבון",
  both: "יעד קלורי ואומדן חלבון",
};

export function getFieldQuestion(field) {
  return FIELD_QUESTIONS_HEBREW[field] || null;
}

// Multi-field: "כדי לחשב לך {label} חסרים לי עוד כמה פרטים:" + a bullet per
// missing field. Single remaining field: "כדי להשלים את החישוב, {question}"
// — a distinct, shorter template, not just the bare question, so a
// one-field follow-up doesn't read like an abrupt non-sequitur.
export function buildMissingFieldsQuestion(missingFields = [], requestType = "calories") {
  const questions = missingFields.map((field) => getFieldQuestion(field)).filter(Boolean);
  if (!questions.length) return "";
  if (questions.length === 1) return `כדי להשלים את החישוב, ${questions[0]}`;

  const label = REQUEST_TYPE_LABEL_HEBREW[requestType] || REQUEST_TYPE_LABEL_HEBREW.calories;

  return [`כדי לחשב לך ${label} חסרים לי עוד כמה פרטים:`, ...questions.map((q) => `• ${q}`)].join("\n");
}

function isPlausibleNumber(value, min, max) {
  const num = Number(value);
  return Number.isFinite(num) && num >= min && num <= max;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Age is never required from the user (see REQUIRED_CALORIE_FIELDS). A real,
 * plausible age — however it became known (web onboarding, or volunteered
 * unprompted in conversation) — is always preferred; otherwise
 * DEFAULT_CALCULATION_AGE is used purely as a technical input to the
 * formula. The distinction is preserved in the returned `ageSource` so
 * callers can tell metadata apart from an actual known age, and NEVER
 * write the default back into the user's profile.
 */
function resolveEffectiveAge(age) {
  if (isPlausibleNumber(age, MIN_PLAUSIBLE_AGE, MAX_PLAUSIBLE_AGE)) {
    return { calculationAgeUsed: Number(age), ageSource: "known" };
  }
  return { calculationAgeUsed: DEFAULT_CALCULATION_AGE, ageSource: "default" };
}

/**
 * Mifflin-St Jeor Basal Metabolic Rate + activity multiplier.
 * Men:   10 * weight(kg) + 6.25 * height(cm) - 5 * age + 5
 * Women: 10 * weight(kg) + 6.25 * height(cm) - 5 * age - 161
 *
 * `age` is optional here — see resolveEffectiveAge(). Every other field is
 * required; this function never guesses weight/height/sex/activity.
 */
export function calculateMaintenanceCalories({ age, sex, heightCm, weightKg, activityLevel } = {}) {
  const normalizedSex = normalizeSex(sex);
  const normalizedActivity = normalizeActivityLevel(activityLevel);

  if (!normalizedSex) return { ok: false, errorCode: "INVALID_SEX" };
  if (!normalizedActivity) return { ok: false, errorCode: "INVALID_ACTIVITY_LEVEL" };
  if (!isPlausibleNumber(heightCm, MIN_PLAUSIBLE_HEIGHT_CM, MAX_PLAUSIBLE_HEIGHT_CM)) {
    return { ok: false, errorCode: "INVALID_HEIGHT" };
  }
  if (!isPlausibleNumber(weightKg, MIN_PLAUSIBLE_WEIGHT_KG, MAX_PLAUSIBLE_WEIGHT_KG)) {
    return { ok: false, errorCode: "INVALID_WEIGHT" };
  }

  const { calculationAgeUsed, ageSource } = resolveEffectiveAge(age);
  const numericHeight = Number(heightCm);
  const numericWeight = Number(weightKg);

  const bmrBase = 10 * numericWeight + 6.25 * numericHeight - 5 * calculationAgeUsed;
  const bmr = Math.round(normalizedSex === "male" ? bmrBase + 5 : bmrBase - 161);
  const activityMultiplier = ACTIVITY_MULTIPLIERS[normalizedActivity];
  const maintenanceCalories = Math.round(bmr * activityMultiplier);

  return {
    ok: true,
    bmr,
    activityLevel: normalizedActivity,
    activityMultiplier,
    maintenanceCalories,
    // Internal calculation metadata ONLY — never rendered as "your age" in
    // any user-facing message (see formatNutritionTargetReplyHebrew).
    calculationAgeUsed,
    ageSource,
  };
}

export function calculateCalorieTarget(profile = {}) {
  const missingFields = getMissingFields(profile, REQUIRED_CALORIE_FIELDS);
  if (missingFields.length) {
    return { ok: false, errorCode: "MISSING_FIELDS", missingFields };
  }

  const unsafeReasons = detectUnsafeConditions({ freeText: profile.safetyContext });
  if (unsafeReasons.length) {
    return { ok: false, errorCode: "UNSAFE_CONDITION", unsafeReasons, message: getUnsafeConditionMessage(unsafeReasons) };
  }

  const normalizedGoal = normalizeGoal(profile.goal);
  if (!normalizedGoal) {
    return { ok: false, errorCode: "INVALID_GOAL" };
  }

  const maintenance = calculateMaintenanceCalories(profile);
  if (!maintenance.ok) return maintenance;

  let adjustment = 0;
  if (normalizedGoal === "lose") adjustment = -DEFAULT_WEIGHT_LOSS_DEFICIT;
  else if (normalizedGoal === "gain") adjustment = DEFAULT_WEIGHT_GAIN_SURPLUS;

  const rawTarget = Math.round(maintenance.maintenanceCalories + adjustment);
  const targetCalories = Math.max(rawTarget, MIN_SAFE_CALORIE_TARGET);
  const wasFloored = targetCalories > rawTarget;

  return {
    ok: true,
    requestType: "calories",
    // The actual input values used for this calculation — echoed back in
    // formatNutritionTargetReplyHebrew() so stale/wrong data is immediately
    // visible to the user instead of hidden inside an opaque final number.
    weightKg: Number(profile.weightKg),
    heightCm: Number(profile.heightCm),
    sex: normalizeSex(profile.sex),
    bmr: maintenance.bmr,
    activityLevel: maintenance.activityLevel,
    activityLevelLabel: ACTIVITY_LEVEL_LABEL_HEBREW[maintenance.activityLevel],
    activityMultiplier: maintenance.activityMultiplier,
    maintenanceCalories: maintenance.maintenanceCalories,
    goal: normalizedGoal,
    targetCalories,
    appliedAdjustment: adjustment,
    flooredToSafeMinimum: wasFloored,
    method: "Mifflin-St Jeor",
    // Internal metadata only, see calculateMaintenanceCalories() — not for
    // display as the user's actual age.
    calculationAgeUsed: maintenance.calculationAgeUsed,
    ageSource: maintenance.ageSource,
  };
}

export function calculateProteinEstimate(profile = {}) {
  const missingFields = getMissingFields(profile, REQUIRED_PROTEIN_FIELDS);
  if (missingFields.length) {
    return { ok: false, errorCode: "MISSING_FIELDS", missingFields };
  }

  // Protein never requires, asks for, or considers age in any way — it
  // only blocks on an explicit safety keyword (pregnancy, breastfeeding,
  // kidney disease, liver disease, eating disorder).
  const unsafeReasons = detectUnsafeConditions({ freeText: profile.safetyContext });
  if (unsafeReasons.length) {
    return { ok: false, errorCode: "UNSAFE_CONDITION", unsafeReasons, message: getUnsafeConditionMessage(unsafeReasons) };
  }

  if (!isPlausibleNumber(profile.weightKg, MIN_PLAUSIBLE_WEIGHT_KG, MAX_PLAUSIBLE_WEIGHT_KG)) {
    return { ok: false, errorCode: "INVALID_WEIGHT" };
  }

  const weightKg = Number(profile.weightKg);
  const normalizedActivity = normalizeActivityLevel(profile.activityLevel);

  const result = {
    ok: true,
    requestType: "protein",
    weightKg,
    activityLevel: normalizedActivity || null,
    activityLevelLabel: normalizedActivity ? ACTIVITY_LEVEL_LABEL_HEBREW[normalizedActivity] : null,
  };

  // Exactly ONE rule/number is ever chosen, based on the activity tier —
  // never a baseline value followed by an unrelated range. sedentary,
  // lightly_active, and "activity unknown" all share the same single-value
  // 0.8 g/kg rule (the safest, most general default).
  if (normalizedActivity === "moderately_active") {
    result.rangeGramsPerDay = {
      low: round1(weightKg * PROTEIN_PER_KG_MODERATE_LOW),
      high: round1(weightKg * PROTEIN_PER_KG_MODERATE_HIGH),
    };
    result.method = `${PROTEIN_PER_KG_MODERATE_LOW}-${PROTEIN_PER_KG_MODERATE_HIGH} גרם חלבון לכל ק"ג משקל גוף (טווח כללי לפעילות בינונית)`;
  } else if (normalizedActivity === "very_active") {
    result.rangeGramsPerDay = {
      low: round1(weightKg * PROTEIN_PER_KG_VERY_ACTIVE_LOW),
      high: round1(weightKg * PROTEIN_PER_KG_VERY_ACTIVE_HIGH),
    };
    result.method = `${PROTEIN_PER_KG_VERY_ACTIVE_LOW}-${PROTEIN_PER_KG_VERY_ACTIVE_HIGH} גרם חלבון לכל ק"ג משקל גוף (טווח כללי לפעילות גבוהה)`;
  } else {
    result.baselineGramsPerDay = round1(weightKg * PROTEIN_PER_KG_BASELINE);
    result.referenceRateGramsPerKg = PROTEIN_PER_KG_BASELINE;
    result.method = `${PROTEIN_PER_KG_BASELINE} גרם חלבון לכל ק"ג משקל גוף (ערך ייחוס כללי)`;
  }

  return result;
}

/**
 * Main orchestration entry point: given a request type and a (possibly
 * partial) profile, returns either a structured, ready-to-relay result or a
 * structured "not yet" reason (missing fields / unsafe / invalid input).
 * Never throws for normal missing/invalid input — always returns a typed
 * result so callers (bot/index.js) can branch safely.
 */
export function getNutritionTarget({ requestType, profile = {} } = {}) {
  if (requestType === "protein") return calculateProteinEstimate(profile);
  if (requestType === "calories") return calculateCalorieTarget(profile);

  if (requestType === "both") {
    return {
      ok: true,
      requestType: "both",
      protein: calculateProteinEstimate(profile),
      calories: calculateCalorieTarget(profile),
    };
  }

  return { ok: false, errorCode: "UNKNOWN_REQUEST_TYPE" };
}

// ---------------------------------------------------------------------
// Free-text profile-answer parsing (deterministic, Hebrew/English) — used
// when the bot has asked the user for missing fields and they reply in a
// single free-text message, e.g. "אני בת 28, גובה 165, שוקלת 60 קילו,
// פעילות בינונית, רוצה לרדת במשקל".
//
// Numeric fields (weight, height) go through a *result* helper that
// distinguishes three outcomes, not two:
//   - not mentioned at all              -> silently omitted, never guessed
//   - mentioned but rejected as implausible (e.g. "גובה 17", "שוקלת 600")
//     -> reported as an explicit rejection so the caller can explain
//        *why*, instead of either silently dropping it (which previously
//        let the message fall through to the unconstrained generic chat
//        function, which could hallucinate a "saved!" confirmation for a
//        value that was never actually stored) or applying a generic
//        "couldn't calculate" failure.
//   - mentioned and valid                -> the normalized value
// ---------------------------------------------------------------------

function extractAge(text) {
  const match = text.match(/(?:בת|בן|גיל)\s*(\d{1,3})/) || text.match(/\b(\d{1,3})\s*(?:שנים|שנה)(?![\p{L}])/u);
  if (match) {
    const age = Number(match[1]);
    if (isPlausibleNumber(age, MIN_PLAUSIBLE_AGE, MAX_PLAUSIBLE_AGE)) return age;
  }
  return null;
}

// Hebrew grammatically genders the common "age N" phrasing itself
// ("בת 28" = female, "בן 28" = male), so it doubles as a sex signal.
function extractGenderMarkerFromAgePhrase(text) {
  if (/(?:^|\s)בת\s*\d{1,3}/.test(text)) return "female";
  if (/(?:^|\s)בן\s*\d{1,3}/.test(text)) return "male";
  return null;
}

function extractSex(text) {
  if (text.includes("נקבה") || text.includes("אישה") || text.includes("אשה")) return "female";
  if (text.includes("זכר") || text.includes("גבר")) return "male";
  return extractGenderMarkerFromAgePhrase(text);
}

const FIELD_NOT_MENTIONED = Object.freeze({ present: false, valid: false, value: null, raw: null });

function numericFieldResult(present, valid, value, raw) {
  return { present, valid, value, raw };
}

// A height value of 1.20-2.30 is unambiguously meters ("1.7", "1.70") and
// is converted to centimeters; a plain 50-250 is already centimeters.
// heightCm is the ONLY thing ever stored — a meters value is never stored
// as-is (e.g. "1.7" must never become heightCm: 1.7).
function metersToCmIfNeeded(value) {
  if (value >= 1.2 && value <= 2.3) return Math.round(value * 100);
  return value;
}

/**
 * Returns { present, valid, value, raw } for a height mention anywhere in
 * free text. Handles cm ("170", "170 ס״מ"), meters with the "גובה" keyword
 * ("גובה 1.7", "גובה 1.70", "הגובה שלי הוא 1.70"), an explicit meters unit
 * ("1.7 מטר"), and a bare self-statement in meters ("אני 1.70").
 */
function extractHeightResult(text) {
  const match =
    text.match(/גובה\s*(?:שלי\s*)?(?:הוא\s*)?(\d{1,3}(?:\.\d+)?)/) ||
    // NOTE: `\b` is unusable after Hebrew letters — JS regex treats \w (and
    // therefore \b) as ASCII-only, so a boundary after "סמ"/"מטר" would
    // silently never match. A Unicode-aware negative lookahead is used
    // instead (`u` flag + \p{L}) to require the match not be immediately
    // followed by another letter, without relying on \b.
    text.match(/(\d{2,3}(?:\.\d+)?)\s*(?:ס"מ|סמ|cm)(?![\p{L}])/imu) ||
    text.match(/(\d(?:\.\d{1,2})?)\s*מטר(?![\p{L}])/u) ||
    text.match(/(?:^|\s)אני\s+(\d\.\d{1,2})(?:\s|$)/);

  if (!match) return FIELD_NOT_MENTIONED;

  const raw = match[0].trim();
  const rawValue = Number(match[1]);
  if (!Number.isFinite(rawValue)) return numericFieldResult(true, false, null, raw);

  const heightCm = metersToCmIfNeeded(rawValue);
  if (isPlausibleNumber(heightCm, MIN_PLAUSIBLE_HEIGHT_CM, MAX_PLAUSIBLE_HEIGHT_CM)) {
    return numericFieldResult(true, true, heightCm, raw);
  }
  return numericFieldResult(true, false, null, raw);
}

/**
 * Returns { present, valid, value, raw } for a weight mention anywhere in
 * free text ("אני שוקלת 60", "שוקלת 60", "משקל 60", "60 קילו", "60 ק״ג").
 */
function extractWeightResult(text) {
  const match =
    text.match(/(?:שוקל|שוקלת|משקל)\s*(?:שלי\s*)?(?:הוא\s*)?(\d{1,3}(?:\.\d+)?)/) ||
    text.match(/(\d{1,3}(?:\.\d+)?)\s*(?:ק"ג|קילו(?:גרם)?|kg)(?![\p{L}])/imu);

  if (!match) return FIELD_NOT_MENTIONED;

  const raw = match[0].trim();
  const weightKg = Number(match[1]);
  if (isPlausibleNumber(weightKg, MIN_PLAUSIBLE_WEIGHT_KG, MAX_PLAUSIBLE_WEIGHT_KG)) {
    return numericFieldResult(true, true, weightKg, raw);
  }
  return numericFieldResult(true, false, null, raw);
}

// Hebrew explanation of exactly what was wrong, shown instead of either
// silently ignoring the message or a generic "couldn't calculate" failure.
const INVALID_FIELD_MESSAGE_HEBREW = {
  heightCm: 'לא הצלחתי להבין את הגובה. אפשר לכתוב למשל 170 ס"מ או 1.70 מטר?',
  weightKg: "נראה שהמשקל שהוזן אינו תקין. אפשר לכתוב את המשקל בקילוגרמים?",
};

export function getInvalidFieldMessage(field) {
  return INVALID_FIELD_MESSAGE_HEBREW[field] || null;
}

/**
 * The single authoritative free-text profile parser. Parses as many of the
 * six profile fields as it can confidently find from one message, and
 * separately reports any field that was clearly attempted but rejected as
 * implausible (`invalidFields`) — so a caller can explain the rejection
 * specifically instead of silently dropping it or falling through to the
 * unconstrained generic chat function.
 */
export function parseNutritionProfileFields(rawText = "", _context = {}) {
  const text = String(rawText || "").trim();
  const lower = text.toLowerCase();

  const fields = {};
  const invalidFields = {};

  const age = extractAge(lower);
  if (age !== null) fields.age = age;

  const sex = extractSex(lower);
  if (sex) fields.sex = sex;

  const heightResult = extractHeightResult(lower);
  if (heightResult.present) {
    if (heightResult.valid) fields.heightCm = heightResult.value;
    else invalidFields.heightCm = { raw: heightResult.raw };
  }

  const weightResult = extractWeightResult(lower);
  if (weightResult.present) {
    if (weightResult.valid) fields.weightKg = weightResult.value;
    else invalidFields.weightKg = { raw: weightResult.raw };
  }

  const activityLevel = normalizeActivityLevel(lower);
  if (activityLevel) fields.activityLevel = activityLevel;

  const goal = normalizeGoal(lower);
  if (goal) fields.goal = goal;

  return { fields, invalidFields };
}

/**
 * Backward/simple-compatible alias: the valid, normalized fields only (same
 * flat shape used throughout the rest of this module and by callers that
 * don't need to react to invalid attempts). Prefer
 * parseNutritionProfileFields() directly when the caller also needs
 * `invalidFields`.
 */
export function parseProfileAnswerText(rawText = "") {
  return parseNutritionProfileFields(rawText).fields;
}

/**
 * Interprets a single bare answer (e.g. just "28", "170", or "בינונית") in
 * the context of the ONE field the bot most recently asked about — used
 * when a user answers a single follow-up question tersely instead of in
 * full sentences. Falls back to the general free-text parser first, and
 * distinguishes "not understood at all" from "understood but rejected as
 * implausible" via the `valid`/`present` flags.
 */
export function parseSingleFieldAnswerResult(field, rawText = "") {
  const generalParse = parseNutritionProfileFields(rawText);
  if (isPresent(generalParse.fields[field])) {
    return { present: true, valid: true, value: generalParse.fields[field], raw: rawText };
  }
  if (generalParse.invalidFields[field]) {
    return { present: true, valid: false, value: null, raw: generalParse.invalidFields[field].raw };
  }

  const text = String(rawText || "").trim().toLowerCase();
  if (!text) return { present: false, valid: false, value: null, raw: null };

  // A reply with no digit at all (e.g. "לא יודעת") is never a numeric
  // attempt — without this check, `Number("")` (from stripping all
  // non-digits) evaluates to 0, which would be wrongly treated as an
  // out-of-range *attempt* rather than "didn't understand at all".
  const hasDigit = /\d/.test(text);

  if (field === "age") {
    if (!hasDigit) return { present: false, valid: false, value: null, raw: null };
    const num = Number(text.replace(/[^\d.]/g, ""));
    return isPlausibleNumber(num, MIN_PLAUSIBLE_AGE, MAX_PLAUSIBLE_AGE)
      ? { present: true, valid: true, value: num, raw: text }
      : { present: false, valid: false, value: null, raw: null };
  }

  if (field === "heightCm") {
    if (!hasDigit) return { present: false, valid: false, value: null, raw: null };
    const num = Number(text.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(num)) return { present: false, valid: false, value: null, raw: null };
    const cm = metersToCmIfNeeded(num);
    return isPlausibleNumber(cm, MIN_PLAUSIBLE_HEIGHT_CM, MAX_PLAUSIBLE_HEIGHT_CM)
      ? { present: true, valid: true, value: cm, raw: text }
      : { present: true, valid: false, value: null, raw: text };
  }

  if (field === "weightKg") {
    if (!hasDigit) return { present: false, valid: false, value: null, raw: null };
    const num = Number(text.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(num)) return { present: false, valid: false, value: null, raw: null };
    return isPlausibleNumber(num, MIN_PLAUSIBLE_WEIGHT_KG, MAX_PLAUSIBLE_WEIGHT_KG)
      ? { present: true, valid: true, value: num, raw: text }
      : { present: true, valid: false, value: null, raw: text };
  }

  if (field === "sex") {
    const value = normalizeSex(text);
    return value
      ? { present: true, valid: true, value, raw: text }
      : { present: false, valid: false, value: null, raw: null };
  }

  if (field === "activityLevel") {
    const value = normalizeActivityLevel(text);
    return value
      ? { present: true, valid: true, value, raw: text }
      : { present: false, valid: false, value: null, raw: null };
  }

  if (field === "goal") {
    const value = normalizeGoal(text);
    return value
      ? { present: true, valid: true, value, raw: text }
      : { present: false, valid: false, value: null, raw: null };
  }

  return { present: false, valid: false, value: null, raw: null };
}

/**
 * Simple value-or-null form of parseSingleFieldAnswerResult(), for callers
 * that don't need to distinguish "not understood" from "understood but
 * rejected" (most existing call sites, and the general-purpose test suite).
 */
export function parseSingleFieldAnswer(field, rawText = "") {
  const result = parseSingleFieldAnswerResult(field, rawText);
  return result.valid ? result.value : null;
}

// ---------------------------------------------------------------------
// User-facing Hebrew formatting for a successful result.
// ---------------------------------------------------------------------

// The direct, final answer wording. Deliberately never uses "בוודאות",
// "מדויק", "רפואי", or any "adults only" phrasing — the estimate is framed
// as general, not as a medical claim. Never mentions age (real or default).
export function formatNutritionTargetReplyHebrew(result) {
  if (!result?.ok) return "";

  if (result.requestType === "protein") {
    // Exactly ONE rule is ever shown — a baseline single value OR a range,
    // never both — matching whichever branch calculateProteinEstimate()
    // actually chose. Always states the weight and activity level actually
    // used, so a stale-data bug is visible in the reply itself.
    if (result.rangeGramsPerDay) {
      const activityClause = result.activityLevelLabel ? ` ו${result.activityLevelLabel}` : "";
      return `לפי משקל של ${result.weightKg} ק"ג${activityClause}, טווח כללי מתאים הוא כ-${result.rangeGramsPerDay.low}-${result.rangeGramsPerDay.high} גרם חלבון ביום.`;
    }

    const activityClause = result.activityLevelLabel ? ` ו${result.activityLevelLabel}` : "";
    return `לפי משקל של ${result.weightKg} ק"ג${activityClause}, האומדן הכללי הוא כ-${result.baselineGramsPerDay} גרם חלבון ביום.`;
  }

  if (result.requestType === "calories") {
    // Always states the actual weight/height/activity level/goal used for
    // this specific calculation as an explicit bulleted list, so a
    // stale-data bug is immediately visible in the reply itself instead of
    // hidden behind a single opaque number.
    const activityShortLabel = ACTIVITY_LEVEL_SHORT_LABEL_HEBREW[result.activityLevel] || "";
    const goalLabel = GOAL_LABEL_HEBREW[result.goal] || "";

    const lines = [
      [
        "לפי הנתונים שמסרת:",
        `• משקל: ${result.weightKg} ק"ג`,
        `• גובה: ${result.heightCm} ס"מ`,
        `• רמת פעילות: ${activityShortLabel}`,
        `• מטרה: ${goalLabel}`,
      ].join("\n"),
      `צריכת התחזוקה המשוערת שלך היא כ-${result.maintenanceCalories} קלוריות ביום.`,
    ];

    if (result.goal === "lose") {
      lines.push(`לירידה הדרגתית במשקל, יעד התחלתי הוא כ-${result.targetCalories} קלוריות ביום.`);
    } else if (result.goal === "gain") {
      lines.push(`לעלייה הדרגתית במשקל, יעד התחלתי הוא כ-${result.targetCalories} קלוריות ביום.`);
    } else {
      lines.push(`כדי לשמור על המשקל הנוכחי, אפשר להמשיך לצרוך כ-${result.targetCalories} קלוריות ביום.`);
    }

    if (result.flooredToSafeMinimum) {
      lines.push("שימו לב: היעד הותאם לרף המינימלי המומלץ, ולא ירד מתחתיו.");
    }

    lines.push("זהו אומדן כללי המבוסס על המשקל, הגובה, המין ורמת הפעילות שלך.");

    return lines.join("\n\n");
  }

  return "";
}

// ---------------------------------------------------------------------
// Deterministic profile merge with an explicit, last-write-wins layer
// priority. This is the single authoritative place values from different
// sources (web onboarding, previously stored WhatsApp memory, the current
// multi-turn pending session, and the current incoming message) are
// combined — callers in bot/index.js must use this instead of hand-rolled
// object spreads, so stale data can never silently win over a fresher
// value.
//
// Priority (lowest to highest — later layers overwrite earlier ones):
//   1. webProfile          - web onboarding profile (users/{uid})
//   2. storedTargetProfile - previously saved WhatsApp targetProfile memory
//   3. pendingProfile      - fields collected earlier in THIS active session
//   4. currentMessageProfile - fields parsed from the message being handled
//      right now — always wins, since it is by definition the freshest
//      information the user has just provided.
// ---------------------------------------------------------------------
export function mergeNutritionProfile({
  webProfile = {},
  storedTargetProfile = {},
  pendingProfile = {},
  currentMessageProfile = {},
} = {}) {
  const layers = [
    { name: "web_profile", data: webProfile },
    { name: "stored_target_profile", data: storedTargetProfile },
    { name: "pending_session", data: pendingProfile },
    { name: "current_message", data: currentMessageProfile },
  ];

  const profile = {};
  const fieldSources = {};

  for (const layer of layers) {
    for (const [field, value] of Object.entries(layer.data || {})) {
      if (!isPresent(value)) continue;
      profile[field] = value;
      fieldSources[field] = layer.name;
    }
  }

  return { profile, fieldSources };
}

export { isPresent };
