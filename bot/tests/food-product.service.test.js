import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeBarcode,
  getProductByBarcode,
  calculateNutritionForWeight,
  calculateNutritionForPackageFraction,
  hasUsableCoreNutrition,
  formatProductNutritionForUser,
  PRODUCT_NOT_FOUND_HEBREW,
  PRODUCT_LOOKUP_UNAVAILABLE_HEBREW,
  PRODUCT_INCOMPLETE_HEBREW,
  INVALID_BARCODE_HEBREW,
  PACKAGE_WEIGHT_IS_VOLUME_HEBREW,
  formatProductConfirmationSummary,
} from "../services/food-product.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function buildOffProduct(overrides = {}, nutrimentOverrides = {}) {
  return {
    status: 1,
    product: {
      code: "7290000000000",
      product_name: "Cottage Cheese 5%",
      product_name_he: "קוטג׳ 5%",
      brands: "טרה",
      quantity: "250 גרם",
      product_quantity: "250",
      product_quantity_unit: "g",
      serving_size: "100 גרם",
      serving_quantity: "100",
      nutrition_data_per: "100g",
      nutriments: {
        "energy-kcal_100g": 98,
        proteins_100g: 9.5,
        carbohydrates_100g: 3.4,
        sugars_100g: 3.4,
        fat_100g: 5,
        "saturated-fat_100g": 3.2,
        fiber_100g: 0,
        sodium_100g: 0.38,
        salt_100g: 0.95,
        ...nutrimentOverrides,
      },
      image_front_url: "https://example.com/front.jpg",
      image_nutrition_url: "https://example.com/nutrition.jpg",
      last_modified_t: 1700000000,
      data_quality_tags: ["complete-nutrition"],
      completeness: 0.9,
      ...overrides,
    },
  };
}

function makeFetchStub({ ok = true, status = 200, jsonBody = {}, throwError = null } = {}) {
  return async function fetchStub() {
    if (throwError) throw throwError;
    return {
      ok,
      status,
      json: async () => jsonBody,
    };
  };
}

// 1. valid barcode
test("normalizeBarcode accepts a valid EAN-13 barcode", () => {
  const result = normalizeBarcode("7290000000000");
  assert.equal(result.ok, true);
  assert.equal(result.barcode, "7290000000000");
});

// 2. invalid barcode
test("normalizeBarcode rejects blank, non-digit, and unrealistic-length input", () => {
  assert.equal(normalizeBarcode("   ").ok, false);
  assert.equal(normalizeBarcode("   ").errorCode, "BLANK_BARCODE");

  assert.equal(normalizeBarcode("abc12345").ok, false);
  assert.equal(normalizeBarcode("abc12345").errorCode, "INVALID_FORMAT");

  assert.equal(normalizeBarcode("123").ok, false);
  assert.equal(normalizeBarcode("123").errorCode, "INVALID_LENGTH");
});

test("normalizeBarcode trims surrounding whitespace", () => {
  const result = normalizeBarcode("  7290000000000  ");
  assert.equal(result.ok, true);
  assert.equal(result.barcode, "7290000000000");
});

// 3. product not found
test("getProductByBarcode returns PRODUCT_NOT_FOUND when Open Food Facts has no match", async () => {
  const fetchImpl = makeFetchStub({ jsonBody: { status: 0 } });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.equal(result.found, false);
  assert.equal(result.errorCode, "PRODUCT_NOT_FOUND");
});

// 4. API failure
test("getProductByBarcode returns PRODUCT_LOOKUP_FAILED on network error", async () => {
  const fetchImpl = makeFetchStub({ throwError: new Error("network down") });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.equal(result.found, false);
  assert.equal(result.errorCode, "PRODUCT_LOOKUP_FAILED");
});

test("getProductByBarcode returns PRODUCT_LOOKUP_FAILED on non-ok HTTP response", async () => {
  const fetchImpl = makeFetchStub({ ok: false, status: 503, jsonBody: {} });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.equal(result.found, false);
  assert.equal(result.errorCode, "PRODUCT_LOOKUP_FAILED");
});

test("getProductByBarcode rejects an invalid barcode before making a network request", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ status: 0 }) };
  };

  const result = await getProductByBarcode("not-a-barcode", { fetchImpl });

  assert.equal(result.found, false);
  assert.equal(result.errorCode, "INVALID_FORMAT");
  assert.equal(calls, 0);
});

// 5. Hebrew product name preferred
test("getProductByBarcode prefers the Hebrew product name when available", async () => {
  const fetchImpl = makeFetchStub({ jsonBody: buildOffProduct() });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.equal(result.found, true);
  assert.equal(result.product.name, "קוטג׳ 5%");
});

// 6. fallback to general product name
test("getProductByBarcode falls back to the general product name without Hebrew", async () => {
  const fetchImpl = makeFetchStub({
    jsonBody: buildOffProduct({ product_name_he: "" }),
  });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.equal(result.product.name, "Cottage Cheese 5%");
});

// 7. kcal read directly
test("getProductByBarcode reads energy-kcal_100g directly when present", async () => {
  const fetchImpl = makeFetchStub({ jsonBody: buildOffProduct() });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.equal(result.product.nutritionPer100g.calories, 98);
  assert.equal(result.product.caloriesBasis, "kcal");
});

// 8. kJ converted to kcal
test("getProductByBarcode converts energy_100g in kJ to kcal when kcal is missing", async () => {
  const fetchImpl = makeFetchStub({
    jsonBody: buildOffProduct({}, { "energy-kcal_100g": undefined, energy_100g: 418.4 }),
  });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.ok(Math.abs(result.product.nutritionPer100g.calories - 100) < 0.01);
  assert.equal(result.product.caloriesBasis, "kj_converted");
});

// 9. missing values remain null
test("getProductByBarcode preserves null for missing nutrients instead of using zero", async () => {
  const fetchImpl = makeFetchStub({
    jsonBody: buildOffProduct({}, { fiber_100g: undefined, sodium_100g: undefined }),
  });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.equal(result.product.nutritionPer100g.fiberGrams, null);
  assert.equal(result.product.nutritionPer100g.sodiumGrams, null);
});

// 10. complete product detection
test("getProductByBarcode marks a product with all core fields as complete", async () => {
  const fetchImpl = makeFetchStub({ jsonBody: buildOffProduct() });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.equal(result.product.isComplete, true);
  assert.deepEqual(result.product.missingCoreFields, []);
  assert.equal(result.product.nutritionConfidence, "high");
  assert.equal(hasUsableCoreNutrition(result.product), true);
});

// 11. incomplete product detection
test("getProductByBarcode marks a product missing a core field as incomplete", async () => {
  const fetchImpl = makeFetchStub({
    jsonBody: buildOffProduct({}, { proteins_100g: undefined }),
  });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.equal(result.product.isComplete, false);
  assert.ok(result.product.missingCoreFields.includes("proteinGrams"));
  assert.equal(hasUsableCoreNutrition(result.product), false);
});

// 12. calculation for 100 grams
test("calculateNutritionForWeight computes values for 100 grams (identity)", () => {
  const nutritionPer100g = {
    calories: 98,
    proteinGrams: 9.5,
    carbohydratesGrams: 3.4,
    sugarsGrams: 3.4,
    fatGrams: 5,
    saturatedFatGrams: 3.2,
    fiberGrams: 0,
    sodiumGrams: 0.38,
    saltGrams: 0.95,
  };

  const result = calculateNutritionForWeight(nutritionPer100g, 100);

  assert.equal(result.ok, true);
  assert.equal(result.result.amountType, "grams");
  assert.equal(result.result.calories, 98);
  assert.equal(result.result.proteinGrams, 9.5);
  assert.equal(result.result.fatGrams, 5);
});

// 13. calculation for 125 grams
test("calculateNutritionForWeight scales values for 125 grams", () => {
  const nutritionPer100g = { calories: 98, proteinGrams: 9.5, carbohydratesGrams: 3.4, fatGrams: 5 };
  const result = calculateNutritionForWeight(nutritionPer100g, 125);

  assert.equal(result.ok, true);
  assert.equal(result.result.calories, 122.5);
  assert.equal(result.result.proteinGrams, 11.9);
  assert.equal(result.result.weightGrams, 125);
});

// 14. calculation for full package
test("calculateNutritionForPackageFraction computes a full package", () => {
  const product = {
    packageWeightGrams: 250,
    nutritionPer100g: { calories: 98, proteinGrams: 9.5, carbohydratesGrams: 3.4, fatGrams: 5 },
  };

  const result = calculateNutritionForPackageFraction(product, 1);

  assert.equal(result.ok, true);
  assert.equal(result.result.amountType, "package_fraction");
  assert.equal(result.result.packageFraction, 1);
  assert.equal(result.result.weightGrams, 250);
  assert.equal(result.result.calories, 245);
});

// 15. calculation for half package
test("calculateNutritionForPackageFraction computes half a package", () => {
  const product = {
    packageWeightGrams: 250,
    nutritionPer100g: { calories: 98, proteinGrams: 9.5, carbohydratesGrams: 3.4, fatGrams: 5 },
  };

  const result = calculateNutritionForPackageFraction(product, 0.5);

  assert.equal(result.ok, true);
  assert.equal(result.result.weightGrams, 125);
  assert.equal(result.result.calories, 122.5);
});

// 16. unknown package weight
test("calculateNutritionForPackageFraction fails safely when package weight is unknown", () => {
  const product = {
    packageWeightGrams: null,
    nutritionPer100g: { calories: 98, proteinGrams: 9.5, carbohydratesGrams: 3.4, fatGrams: 5 },
  };

  const result = calculateNutritionForPackageFraction(product, 0.5);

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "UNKNOWN_PACKAGE_WEIGHT");
});

// ml/l must never be silently converted to a gram weight (density is unknown).
test("getProductByBarcode never converts ml package quantity to grams", async () => {
  const fetchImpl = makeFetchStub({
    jsonBody: buildOffProduct({
      product_quantity: "500",
      product_quantity_unit: "ml",
      quantity: "500 מ\"ל",
    }),
  });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.equal(result.product.packageWeightGrams, null);
  assert.equal(result.product.packageWeightUnavailableReason, "VOLUME_UNIT");
});

test("getProductByBarcode never converts liter package quantity to grams", async () => {
  const fetchImpl = makeFetchStub({
    jsonBody: buildOffProduct({
      product_quantity: "1",
      product_quantity_unit: "l",
      quantity: "1 ליטר",
    }),
  });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.equal(result.product.packageWeightGrams, null);
  assert.equal(result.product.packageWeightUnavailableReason, "VOLUME_UNIT");
});

test("getProductByBarcode never converts a free-text liter/ml quantity string to grams", async () => {
  const fetchImpl = makeFetchStub({
    jsonBody: buildOffProduct({
      product_quantity: undefined,
      product_quantity_unit: undefined,
      quantity: "1.5 ליטר",
    }),
  });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.equal(result.product.packageWeightGrams, null);
  assert.equal(result.product.packageWeightUnavailableReason, "VOLUME_UNIT");
});

test("getProductByBarcode still converts gram and kilogram package quantities", async () => {
  const gramsFetch = makeFetchStub({
    jsonBody: buildOffProduct({ product_quantity: "250", product_quantity_unit: "g" }),
  });
  const gramsResult = await getProductByBarcode("7290000000000", { fetchImpl: gramsFetch });
  assert.equal(gramsResult.product.packageWeightGrams, 250);
  assert.equal(gramsResult.product.packageWeightUnavailableReason, null);

  const kgFetch = makeFetchStub({
    jsonBody: buildOffProduct({ product_quantity: "1.5", product_quantity_unit: "kg" }),
  });
  const kgResult = await getProductByBarcode("7290000000000", { fetchImpl: kgFetch });
  assert.equal(kgResult.product.packageWeightGrams, 1500);
  assert.equal(kgResult.product.packageWeightUnavailableReason, null);
});

// Package-fraction calculation must fail safely (not guess a density) when
// the package quantity is expressed only in volume.
test("calculateNutritionForPackageFraction fails safely with a distinct code when only volume is known", () => {
  const product = {
    packageWeightGrams: null,
    packageWeightUnavailableReason: "VOLUME_UNIT",
    nutritionPer100g: { calories: 98, proteinGrams: 9.5, carbohydratesGrams: 3.4, fatGrams: 5 },
  };

  const result = calculateNutritionForPackageFraction(product, 0.5);

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "PACKAGE_WEIGHT_IS_VOLUME");
});

test("PACKAGE_WEIGHT_IS_VOLUME_HEBREW matches the required safe wording", () => {
  assert.equal(
    PACKAGE_WEIGHT_IS_VOLUME_HEBREW,
    "משקל האריזה מופיע ביחידות נפח ולא בגרמים, ולכן איני יכולה להמיר אותו למשקל בצורה אמינה. כדי לחשב, כתבי כמה גרם צרכת או שלחי את נתוני המנה מהתווית."
  );
});

// 17. invalid weight
test("calculateNutritionForWeight rejects zero, negative, and unrealistic weights", () => {
  const nutritionPer100g = { calories: 98, proteinGrams: 9.5, carbohydratesGrams: 3.4, fatGrams: 5 };

  assert.equal(calculateNutritionForWeight(nutritionPer100g, 0).ok, false);
  assert.equal(calculateNutritionForWeight(nutritionPer100g, -50).ok, false);
  assert.equal(calculateNutritionForWeight(nutritionPer100g, 999999).ok, false);
});

// 18. invalid fraction
test("calculateNutritionForPackageFraction rejects fractions outside 0-1", () => {
  const product = { packageWeightGrams: 250, nutritionPer100g: { calories: 98 } };

  assert.equal(calculateNutritionForPackageFraction(product, 0).ok, false);
  assert.equal(calculateNutritionForPackageFraction(product, -0.5).ok, false);
  assert.equal(calculateNutritionForPackageFraction(product, 1.5).ok, false);
});

test("calculateNutritionForWeight preserves null for missing nutrients instead of zero", () => {
  const nutritionPer100g = { calories: 98, proteinGrams: null, carbohydratesGrams: 3.4, fatGrams: 5 };
  const result = calculateNutritionForWeight(nutritionPer100g, 100);

  assert.equal(result.ok, true);
  assert.equal(result.result.proteinGrams, null);
});

// 19. user-facing formatter excludes null fields
test("formatProductNutritionForUser omits nutrients that are null", async () => {
  const fetchImpl = makeFetchStub({
    jsonBody: buildOffProduct({}, { fiber_100g: undefined, sodium_100g: undefined, salt_100g: undefined }),
  });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });
  const message = formatProductNutritionForUser(result.product);

  assert.ok(!message.includes("סיבים"));
  assert.ok(!message.includes("נתרן"));
  assert.ok(!message.includes("מלח"));
  assert.ok(message.includes("קלוריות"));
});

// 20. user-facing formatter uses cautious source wording
test("formatProductNutritionForUser uses cautious database-source wording, never 'guaranteed'", async () => {
  const fetchImpl = makeFetchStub({ jsonBody: buildOffProduct() });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });
  const message = formatProductNutritionForUser(result.product);

  assert.ok(message.includes("לפי נתוני התווית השמורים במאגר"));
  assert.ok(!message.includes("מובטח"));
  assert.ok(!message.includes("מדויק ב-100%"));
});

// product confirmation summary must never display the data source to the user
test("formatProductConfirmationSummary never shows a visible source line", () => {
  const product = { name: "קוטג׳ 5%", brand: "טרה", source: "Open Food Facts", barcode: "7290000000000" };
  const calculation = {
    amountType: "grams",
    weightGrams: 125,
    packageFraction: null,
    calories: 122.5,
    proteinGrams: 11.9,
    carbohydratesGrams: 4.3,
    fatGrams: 6.3,
  };

  const summary = formatProductConfirmationSummary(product, calculation);

  assert.ok(!summary.includes("מקור"));
  assert.ok(!summary.includes("Open Food Facts"));
  assert.ok(!summary.includes("Source"));
  assert.ok(summary.includes("קלוריות"));
  assert.ok(summary.includes("להוסיף את המוצר לארוחה"));
});

test("Hebrew fallback messages match the required safe wording", () => {
  assert.equal(
    PRODUCT_NOT_FOUND_HEBREW,
    "לא מצאתי את המוצר לפי הברקוד הזה. אפשר לשלוח צילום ברור של חזית האריזה ושל טבלת הערכים התזונתיים."
  );
  assert.equal(
    PRODUCT_LOOKUP_UNAVAILABLE_HEBREW,
    "כרגע לא הצלחתי לגשת למאגר המוצרים. אפשר לנסות שוב מאוחר יותר או לשלוח צילום של טבלת הערכים שעל האריזה."
  );
  assert.equal(
    PRODUCT_INCOMPLETE_HEBREW,
    "מצאתי את המוצר, אבל הנתונים התזונתיים במאגר אינם מלאים. אפשר לשלוח צילום ברור של טבלת הערכים שעל האריזה."
  );
  assert.ok(INVALID_BARCODE_HEBREW.length > 0);
});

// 26. no secrets in errors
test("error results never leak raw error messages, stacks, or request details", async () => {
  const fetchImpl = makeFetchStub({ throwError: new Error("secret-internal-detail 12345") });
  const result = await getProductByBarcode("7290000000000", { fetchImpl });

  assert.deepEqual(Object.keys(result).sort(), ["barcode", "errorCode", "found"]);
  assert.equal(result.errorCode, "PRODUCT_LOOKUP_FAILED");
});

// 27. OpenAI is never called by the product lookup service
test("the product lookup service never imports or depends on OpenAI", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "services", "food-product.service.js"), "utf8");
  assert.ok(!/openai/i.test(source), "food-product.service.js must not reference OpenAI");
});

test("getProductByBarcode sends a clear User-Agent identifying SNAP EAT", async () => {
  let capturedHeaders = null;
  const fetchImpl = async (_url, init) => {
    capturedHeaders = init?.headers;
    return { ok: true, json: async () => buildOffProduct() };
  };

  await getProductByBarcode("7290000000000", { fetchImpl });

  assert.ok(capturedHeaders?.["User-Agent"]?.includes("SNAP-EAT"));
});
