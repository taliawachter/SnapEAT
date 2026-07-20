import OpenAI from "openai";

// Coarse classification only. This service must never identify a specific
// product or brand, never invent/guess a barcode, and never estimate any
// nutrition value — it exists purely to decide whether an image likely
// shows retail packaging, so the bot can ask for a barcode photo instead of
// guessing the product through generic meal analysis.
export const CLASSIFICATION_VALUES = ["PACKAGED_PRODUCT", "MEAL_OR_FOOD", "UNKNOWN"];

const CLASSIFIER_PROMPT = `
Look at this photo and decide only whether it shows a sealed, branded retail
packaged product (e.g. a branded cup, bottle, box, can, wrapper, or bag —
often with a printed product name or a nutrition-label appearance) versus a
plated or prepared meal / loose food, versus something unclear.

Do not identify the specific product or brand.
Do not invent or guess a barcode number.
Do not estimate or invent any nutrition value.
Only classify — nothing else.

Return ONLY valid JSON in this exact shape:
{"classification": "PACKAGED_PRODUCT" | "MEAL_OR_FOOD" | "UNKNOWN"}
`.trim();

let _client = null;

function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

function normalizeClassification(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return CLASSIFICATION_VALUES.includes(normalized) ? normalized : "UNKNOWN";
}

function parseClassificationResponse(raw = "") {
  try {
    const parsed = JSON.parse(String(raw || "").trim());
    return normalizeClassification(parsed?.classification);
  } catch {
    return "UNKNOWN";
  }
}

function toDataUrl(imageInput, mimeType) {
  if (typeof imageInput === "string") return imageInput;
  if (Buffer.isBuffer(imageInput)) {
    return `data:${mimeType};base64,${imageInput.toString("base64")}`;
  }
  return null;
}

async function defaultClassifyImpl(imageInput, { mimeType = "image/jpeg" } = {}) {
  const client = getClient();
  if (!client) return "UNKNOWN";

  const dataUrl = toDataUrl(imageInput, mimeType);
  if (!dataUrl) return "UNKNOWN";

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: CLASSIFIER_PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  return parseClassificationResponse(resp.choices?.[0]?.message?.content);
}

/**
 * Classifies an image as PACKAGED_PRODUCT, MEAL_OR_FOOD, or UNKNOWN. Never
 * throws for a normal classification failure — falls back to UNKNOWN so
 * callers safely default to the existing meal-analysis flow. Never logs
 * image contents.
 *
 * Unchanged from before non-food detection was added — kept fully
 * independent from classifyFoodImage() below so this function's behavior,
 * contract, and tests never regress.
 */
export async function classifyPackagedProductImage(
  imageInput,
  { classifyImpl = null, mimeType = "image/jpeg" } = {}
) {
  if (!imageInput) {
    return { classification: "UNKNOWN", errorCode: "EMPTY_IMAGE" };
  }

  try {
    const rawClassification = classifyImpl
      ? await classifyImpl(imageInput)
      : await defaultClassifyImpl(imageInput, { mimeType });

    return { classification: normalizeClassification(rawClassification), errorCode: null };
  } catch {
    return { classification: "UNKNOWN", errorCode: "CLASSIFICATION_FAILED" };
  }
}

// ---------------------------------------------------------------------
// Non-food image detection (structured classification)
// ---------------------------------------------------------------------
//
// Separate from classifyPackagedProductImage() above on purpose: that
// function's contract (and its tests) must never change. This is an
// additive capability used to reject images that are not food-related at
// all (e.g. a person, a pet, a random object) before any meal analysis or
// Open Food Facts lookup is attempted — see bot/index.js's image-handling
// flow, where barcode detection always still runs and wins first.

const FOOD_IMAGE_CLASSIFIER_PROMPT = `
Look at this photo and answer:

1. classification: does it show a sealed, branded retail packaged product
   (a branded cup, bottle, box, can, wrapper, or bag — often with a printed
   product name or a nutrition-label appearance)? -> "PACKAGED_PRODUCT"
   Or a plated/prepared meal, snack, or loose food? -> "MEAL_OR_FOOD"
   Or is it unclear? -> "UNKNOWN"

2. isFoodImage: true if the photo is food-related at all (a meal, a snack,
   a packaged food/drink product, or food packaging/label) — false if it
   clearly shows something unrelated to food (e.g. a person, a pet, a car,
   a document, a landscape, a screenshot, a random object).

3. foodConfidence: your confidence in the isFoodImage judgment, 0 to 1.

4. reason: one short sentence explaining the decision.

Do not identify the specific product or brand.
Do not invent or guess a barcode number.
Do not estimate or invent any nutrition value.
Only classify — nothing else.

Return ONLY valid JSON in this exact shape:
{
  "classification": "PACKAGED_PRODUCT" | "MEAL_OR_FOOD" | "UNKNOWN",
  "isFoodImage": boolean,
  "foodConfidence": number,
  "reason": "string"
}
`.trim();

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(1, num));
}

function normalizeFoodImageClassification(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return {
      classification: normalizeClassification(raw.classification),
      isFoodImage: typeof raw.isFoodImage === "boolean" ? raw.isFoodImage : null,
      foodConfidence: clamp01(raw.foodConfidence),
      reason: typeof raw.reason === "string" ? raw.reason.trim().slice(0, 300) : "",
    };
  }

  return { classification: "UNKNOWN", isFoodImage: null, foodConfidence: null, reason: "" };
}

function parseFoodImageClassificationResponse(raw = "") {
  try {
    return normalizeFoodImageClassification(JSON.parse(String(raw || "").trim()));
  } catch {
    return { classification: "UNKNOWN", isFoodImage: null, foodConfidence: null, reason: "" };
  }
}

async function defaultFoodImageClassifyImpl(imageInput, { mimeType = "image/jpeg" } = {}) {
  const client = getClient();
  if (!client) return { classification: "UNKNOWN", isFoodImage: null, foodConfidence: null, reason: "" };

  const dataUrl = toDataUrl(imageInput, mimeType);
  if (!dataUrl) return { classification: "UNKNOWN", isFoodImage: null, foodConfidence: null, reason: "" };

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: FOOD_IMAGE_CLASSIFIER_PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  return parseFoodImageClassificationResponse(resp.choices?.[0]?.message?.content);
}

/**
 * Structured classification: { classification, isFoodImage, foodConfidence,
 * reason, errorCode }. Never throws — a classifier failure (or a missing/
 * empty image) returns isFoodImage/foodConfidence as null (unknown), never
 * as false, so a transient failure can never be mistaken for a confident
 * "this is not food" determination and wrongly block a real meal photo.
 */
export async function classifyFoodImage(imageInput, { classifyImpl = null, mimeType = "image/jpeg" } = {}) {
  if (!imageInput) {
    return { classification: "UNKNOWN", isFoodImage: null, foodConfidence: null, reason: "", errorCode: "EMPTY_IMAGE" };
  }

  try {
    const raw = classifyImpl ? await classifyImpl(imageInput) : await defaultFoodImageClassifyImpl(imageInput, { mimeType });
    return { ...normalizeFoodImageClassification(raw), errorCode: null };
  } catch {
    return { classification: "UNKNOWN", isFoodImage: null, foodConfidence: null, reason: "", errorCode: "CLASSIFICATION_FAILED" };
  }
}

// Below this confidence, we're not confident enough either way to proceed
// with meal analysis or to flatly reject the image as non-food.
export const FOOD_IMAGE_MIN_CONFIDENCE = 0.65;
