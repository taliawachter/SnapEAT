const OPEN_FOOD_FACTS_BASE_URL = "https://world.openfoodfacts.org/api/v2/product";
const DEFAULT_USER_AGENT = "SNAP-EAT/1.0 (nutrition-bot)";
const MAX_WEIGHT_GRAMS = 5000;

const VALID_BARCODE_LENGTHS = new Set([8, 12, 13, 14]);

const BARCODE_INTENT_KEYWORDS = ["ברקוד", "סרקתי", "סריקה", "סרוק"];

const REQUESTED_FIELDS = [
  "code",
  "product_name",
  "product_name_he",
  "generic_name",
  "brands",
  "quantity",
  "product_quantity",
  "product_quantity_unit",
  "serving_size",
  "serving_quantity",
  "nutriments",
  "nutrition_data_per",
  "image_front_url",
  "image_nutrition_url",
  "last_modified_t",
  "data_quality_tags",
  "completeness",
].join(",");

export const PRODUCT_NOT_FOUND_HEBREW =
  "לא מצאתי את המוצר לפי הברקוד הזה. אפשר לשלוח צילום ברור של חזית האריזה ושל טבלת הערכים התזונתיים.";
export const PRODUCT_LOOKUP_UNAVAILABLE_HEBREW =
  "כרגע לא הצלחתי לגשת למאגר המוצרים. אפשר לנסות שוב מאוחר יותר או לשלוח צילום של טבלת הערכים שעל האריזה.";
export const PRODUCT_INCOMPLETE_HEBREW =
  "מצאתי את המוצר, אבל הנתונים התזונתיים במאגר אינם מלאים. אפשר לשלוח צילום ברור של טבלת הערכים שעל האריזה.";
export const INVALID_BARCODE_HEBREW =
  "זה לא נראה כמו ברקוד תקין. אפשר לשלוח מספר ברקוד (בדרך כלל 8, 12, 13 או 14 ספרות)?";
export const PACKAGE_WEIGHT_IS_VOLUME_HEBREW =
  "משקל האריזה מופיע ביחידות נפח ולא בגרמים, ולכן איני יכולה להמיר אותו למשקל בצורה אמינה. כדי לחשב, כתבי כמה גרם צרכת או שלחי את נתוני המנה מהתווית.";
export const SOURCE_DISCLAIMER_HEBREW = "לפי נתוני התווית השמורים במאגר";

function round1(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 10) / 10 : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalizes and validates a candidate barcode. Never throws for normal
 * invalid input — callers get a structured { ok, errorCode } result.
 */
export function normalizeBarcode(value) {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    return { ok: false, errorCode: "BLANK_BARCODE" };
  }

  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, errorCode: "INVALID_FORMAT" };
  }

  if (!VALID_BARCODE_LENGTHS.has(trimmed.length)) {
    return { ok: false, errorCode: "INVALID_LENGTH" };
  }

  return { ok: true, barcode: trimmed };
}

export function findBarcodeCandidate(text = "") {
  const matches = String(text || "").match(/\d{8,14}/g) || [];
  for (const match of matches) {
    if (VALID_BARCODE_LENGTHS.has(match.length)) return match;
  }
  return null;
}

export function hasExplicitBarcodeIntent(text = "") {
  const normalized = String(text || "");
  return BARCODE_INTENT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function resolveCaloriesPer100g(nutriments = {}) {
  const kcal = toNumberOrNull(nutriments["energy-kcal_100g"]);
  if (kcal !== null) {
    return { calories: kcal, basis: "kcal" };
  }

  const kilojoules = toNumberOrNull(nutriments.energy_100g);
  if (kilojoules !== null) {
    return { calories: kilojoules / 4.184, basis: "kj_converted" };
  }

  return { calories: null, basis: null };
}

const VOLUME_UNIT_TEXT_PATTERN = /(\d+(?:\.\d+)?)\s*(?:ml|מ"ל|מל|l\b|ליטר)/;

// Weight-only package parsing. Grams/kilograms are converted with confidence.
// Volume units (ml/l) are NEVER converted to a gram weight — density is not
// known, so a package quantity expressed in volume yields no gram weight at
// all. See isVolumeOnlyPackageQuantity for surfacing that distinctly from a
// genuinely unknown/unparseable quantity.
function parsePackageWeightGrams({ product_quantity, product_quantity_unit, quantity } = {}) {
  const rawQty = toNumberOrNull(product_quantity);
  if (rawQty !== null) {
    const unit = String(product_quantity_unit || "g").toLowerCase();
    if (unit === "g" || unit === "gr" || unit === "grams") return rawQty;
    if (unit === "kg") return rawQty * 1000;
    return null;
  }

  const text = String(quantity || "").toLowerCase().replace(",", ".");

  const kgMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:kg|ק"ג|קג|קילו)/);
  if (kgMatch) return Number(kgMatch[1]) * 1000;

  const gMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:g|gr|grams?|גרם|גר)/);
  if (gMatch) return Number(gMatch[1]);

  return null;
}

// Distinguishes "package quantity is expressed in volume" (ml/l) from other
// reasons the gram weight is unknown, so callers can give a precise,
// non-guessing response instead of a generic "unknown weight" message.
function isVolumeOnlyPackageQuantity({ product_quantity, product_quantity_unit, quantity } = {}) {
  const rawQty = toNumberOrNull(product_quantity);
  if (rawQty !== null) {
    const unit = String(product_quantity_unit || "").toLowerCase();
    return unit === "ml" || unit === "l";
  }

  return VOLUME_UNIT_TEXT_PATTERN.test(String(quantity || "").toLowerCase());
}

/**
 * Looks up a product by barcode against the Open Food Facts API v2.
 * Exact nutrition values come only from the database response — the
 * language model is never consulted here and never fills gaps.
 */
export async function getProductByBarcode(barcode, { fetchImpl = fetch, userAgent, env = process.env } = {}) {
  const normalized = normalizeBarcode(barcode);
  if (!normalized.ok) {
    return { found: false, errorCode: normalized.errorCode, barcode: null };
  }

  const url =
    `${OPEN_FOOD_FACTS_BASE_URL}/${encodeURIComponent(normalized.barcode)}.json` +
    `?fields=${encodeURIComponent(REQUESTED_FIELDS)}`;
  const resolvedUserAgent = userAgent || env?.OPEN_FOOD_FACTS_USER_AGENT || DEFAULT_USER_AGENT;

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { "User-Agent": resolvedUserAgent },
    });
  } catch {
    return { found: false, errorCode: "PRODUCT_LOOKUP_FAILED", barcode: normalized.barcode };
  }

  if (!response?.ok) {
    return { found: false, errorCode: "PRODUCT_LOOKUP_FAILED", barcode: normalized.barcode };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { found: false, errorCode: "PRODUCT_LOOKUP_FAILED", barcode: normalized.barcode };
  }

  if (data?.status !== 1 || !data?.product) {
    return { found: false, errorCode: "PRODUCT_NOT_FOUND", barcode: normalized.barcode };
  }

  const rawProduct = data.product;
  const nutriments = rawProduct?.nutriments || {};
  const { calories, basis: caloriesBasis } = resolveCaloriesPer100g(nutriments);

  const nutritionPer100g = {
    calories,
    proteinGrams: toNumberOrNull(nutriments.proteins_100g),
    carbohydratesGrams: toNumberOrNull(nutriments.carbohydrates_100g),
    sugarsGrams: toNumberOrNull(nutriments.sugars_100g),
    fatGrams: toNumberOrNull(nutriments.fat_100g),
    saturatedFatGrams: toNumberOrNull(nutriments["saturated-fat_100g"]),
    fiberGrams: toNumberOrNull(nutriments.fiber_100g),
    sodiumGrams: toNumberOrNull(nutriments.sodium_100g),
    saltGrams: toNumberOrNull(nutriments.salt_100g),
  };

  const missingCoreFields = ["calories", "proteinGrams", "carbohydratesGrams", "fatGrams"].filter(
    (field) => nutritionPer100g[field] === null,
  );
  const isComplete = missingCoreFields.length === 0;
  const nutritionConfidence = isComplete ? "high" : missingCoreFields.length < 4 ? "partial" : "none";

  const name =
    String(rawProduct.product_name_he || "").trim() ||
    String(rawProduct.product_name || "").trim() ||
    String(rawProduct.generic_name || "").trim() ||
    "מוצר ללא שם";

  const product = {
    barcode: normalized.barcode,
    name,
    brand: String(rawProduct.brands || "").trim() || null,
    packageQuantity: String(rawProduct.quantity || "").trim() || null,
    packageWeightGrams: parsePackageWeightGrams(rawProduct),
    packageWeightUnavailableReason:
      parsePackageWeightGrams(rawProduct) === null && isVolumeOnlyPackageQuantity(rawProduct)
        ? "VOLUME_UNIT"
        : null,
    servingSize: String(rawProduct.serving_size || "").trim() || null,
    servingQuantityGrams: toNumberOrNull(rawProduct.serving_quantity),
    nutritionBasis: String(rawProduct.nutrition_data_per || "").trim() || null,
    caloriesBasis,
    nutritionPer100g,
    isComplete,
    missingCoreFields,
    nutritionConfidence,
    imageUrl: rawProduct.image_front_url || null,
    nutritionImageUrl: rawProduct.image_nutrition_url || null,
    lastModifiedAt: rawProduct.last_modified_t
      ? new Date(Number(rawProduct.last_modified_t) * 1000).toISOString()
      : null,
    qualityTags: Array.isArray(rawProduct.data_quality_tags) ? rawProduct.data_quality_tags : [],
    completeness: toNumberOrNull(rawProduct.completeness),
    source: "Open Food Facts",
  };

  return { found: true, product, errorCode: null };
}

export function hasUsableCoreNutrition(product) {
  const n = product?.nutritionPer100g;
  if (!n) return false;
  return (
    n.calories !== null && n.proteinGrams !== null && n.carbohydratesGrams !== null && n.fatGrams !== null
  );
}

/**
 * Deterministic weight-based calculation. Never invokes the language model.
 * Fails safely (structured error) instead of throwing for invalid input.
 */
export function calculateNutritionForWeight(nutritionPer100g, weightGrams) {
  const normalizedWeight = Number(weightGrams);

  if (!Number.isFinite(normalizedWeight) || normalizedWeight <= 0 || normalizedWeight > MAX_WEIGHT_GRAMS) {
    return { ok: false, errorCode: "INVALID_WEIGHT" };
  }

  const multiplier = normalizedWeight / 100;

  function calc(value) {
    if (value === null || value === undefined) return null;
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return null;
    return Math.round(normalized * multiplier * 10) / 10;
  }

  return {
    ok: true,
    result: {
      amountType: "grams",
      weightGrams: round1(normalizedWeight),
      packageFraction: null,
      calories: calc(nutritionPer100g?.calories),
      proteinGrams: calc(nutritionPer100g?.proteinGrams),
      carbohydratesGrams: calc(nutritionPer100g?.carbohydratesGrams),
      sugarsGrams: calc(nutritionPer100g?.sugarsGrams),
      fatGrams: calc(nutritionPer100g?.fatGrams),
      saturatedFatGrams: calc(nutritionPer100g?.saturatedFatGrams),
      fiberGrams: calc(nutritionPer100g?.fiberGrams),
      sodiumGrams: calc(nutritionPer100g?.sodiumGrams),
      saltGrams: calc(nutritionPer100g?.saltGrams),
    },
  };
}

export function calculateNutritionForPackageFraction(product, fraction) {
  const normalizedFraction = Number(fraction);

  if (!Number.isFinite(normalizedFraction) || normalizedFraction <= 0 || normalizedFraction > 1) {
    return { ok: false, errorCode: "INVALID_FRACTION" };
  }

  if (product?.packageWeightUnavailableReason === "VOLUME_UNIT") {
    return { ok: false, errorCode: "PACKAGE_WEIGHT_IS_VOLUME" };
  }

  const packageWeightGrams = Number(product?.packageWeightGrams);
  if (!Number.isFinite(packageWeightGrams) || packageWeightGrams <= 0) {
    return { ok: false, errorCode: "UNKNOWN_PACKAGE_WEIGHT" };
  }

  const weightGrams = packageWeightGrams * normalizedFraction;
  const weightResult = calculateNutritionForWeight(product?.nutritionPer100g, weightGrams);
  if (!weightResult.ok) return weightResult;

  return {
    ok: true,
    result: {
      ...weightResult.result,
      amountType: "package_fraction",
      packageFraction: normalizedFraction,
    },
  };
}

export function formatProductNutritionForUser(product, { includeQuestionPrompt = true } = {}) {
  const n = product?.nutritionPer100g || {};
  const lines = [];

  const brandSuffix = product?.brand ? ` של ${product.brand}` : "";
  lines.push(`מצאתי: ${product?.name || "מוצר"}${brandSuffix}.`);

  if (product?.packageQuantity) {
    lines.push(`כמות אריזה: ${product.packageQuantity}`);
  }

  lines.push("", `${SOURCE_DISCLAIMER_HEBREW}, ל-100 גרם:`);

  const nutrientLines = [
    n.calories !== null && n.calories !== undefined ? `• קלוריות: ${round1(n.calories)}` : null,
    n.proteinGrams !== null && n.proteinGrams !== undefined ? `• חלבון: ${round1(n.proteinGrams)} גרם` : null,
    n.carbohydratesGrams !== null && n.carbohydratesGrams !== undefined
      ? `• פחמימות: ${round1(n.carbohydratesGrams)} גרם`
      : null,
    n.sugarsGrams !== null && n.sugarsGrams !== undefined ? `• מתוכן סוכרים: ${round1(n.sugarsGrams)} גרם` : null,
    n.fatGrams !== null && n.fatGrams !== undefined ? `• שומן: ${round1(n.fatGrams)} גרם` : null,
    n.saturatedFatGrams !== null && n.saturatedFatGrams !== undefined
      ? `• מתוכן רווי: ${round1(n.saturatedFatGrams)} גרם`
      : null,
    n.fiberGrams !== null && n.fiberGrams !== undefined ? `• סיבים: ${round1(n.fiberGrams)} גרם` : null,
    n.sodiumGrams !== null && n.sodiumGrams !== undefined ? `• נתרן: ${round1(n.sodiumGrams)} גרם` : null,
    n.saltGrams !== null && n.saltGrams !== undefined ? `• מלח: ${round1(n.saltGrams)} גרם` : null,
  ].filter(Boolean);

  lines.push(...nutrientLines);

  if (includeQuestionPrompt) {
    lines.push("", "כמה אכלת?", "אפשר לכתוב למשל:", "• 125 גרם", "• חצי אריזה", "• אריזה שלמה");
  }

  return lines.join("\n");
}

export function formatProductConfirmationSummary(product, calculation) {
  const lines = [`${product?.name || "מוצר"}${product?.brand ? ` (${product.brand})` : ""}`];

  const amountText =
    calculation?.amountType === "package_fraction"
      ? formatPackageFractionLabel(calculation.packageFraction)
      : `${round1(calculation?.weightGrams)} גרם`;
  lines.push(`כמות: ${amountText}`);

  if (calculation?.calories !== null && calculation?.calories !== undefined) {
    lines.push(`קלוריות: ${round1(calculation.calories)}`);
  }
  if (calculation?.proteinGrams !== null && calculation?.proteinGrams !== undefined) {
    lines.push(`חלבון: ${round1(calculation.proteinGrams)} גרם`);
  }
  if (calculation?.carbohydratesGrams !== null && calculation?.carbohydratesGrams !== undefined) {
    lines.push(`פחמימות: ${round1(calculation.carbohydratesGrams)} גרם`);
  }
  if (calculation?.fatGrams !== null && calculation?.fatGrams !== undefined) {
    lines.push(`שומן: ${round1(calculation.fatGrams)} גרם`);
  }

  lines.push("", "להוסיף את המוצר לארוחה? אפשר לענות כן או לא.");

  return lines.join("\n");
}

export function formatPackageFractionLabel(fraction) {
  if (fraction === 1) return "אריזה שלמה";
  if (fraction === 0.5) return "חצי אריזה";
  if (fraction === 0.25) return "רבע אריזה";
  return `${Math.round(fraction * 100)}% מהאריזה`;
}
