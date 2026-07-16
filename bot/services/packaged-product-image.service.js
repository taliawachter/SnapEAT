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
