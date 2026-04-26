import fs from "fs";
import path from "path";
import OpenAI from "openai";

let _client = null;
const DEBUG_MEAL_ANALYSIS = process.env.DEBUG_MEAL_ANALYSIS === "true";

function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

function stripJsonCodeBlock(text = "") {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeIngredient(item) {
  const qty = item?.quantity ?? item?.amount;
  const grams = item?.grams;

  const quantity =
    (typeof qty === "string" && qty.trim())
      ? qty.trim()
      : (grams !== null && grams !== undefined && grams !== "")
        ? `${Number(grams) || grams} גרם`
        : "לא צוין";

  const calories = Number(item?.calories ?? item?.kcal ?? 0);
  const protein = Number(item?.protein ?? 0);
  const carbs = Number(item?.carbs ?? item?.carbohydrates ?? 0);
  const fat = Number(item?.fat ?? item?.fats ?? 0);

  return {
    name: String(item?.name || item?.foodName || item?.ingredientName || "רכיב"),
    quantity,
    calories: Number.isFinite(calories) ? calories : 0,
    protein: Number.isFinite(protein) ? protein : 0,
    carbs: Number.isFinite(carbs) ? carbs : 0,
    fat: Number.isFinite(fat) ? fat : 0,
  };
}

export async function analyzeMealImage(imagePath) {
  const client = getClient();

  if (!client) {
    const err = new Error("AI analysis is not configured");
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase().replace(".", "") || "jpeg";
  const mimeType =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  const prompt = `Analyze the food in this uploaded image. Do not assume it is yogurt, blueberries, or honey unless they are clearly visible.

Return ONLY a valid JSON object with this exact structure (no markdown, no extra text):
{
  "mealName": "name of the meal in Hebrew",
  "ingredients": [
    {
      "name": "ingredient name in Hebrew",
      "quantity": "estimated quantity e.g. 1 unit, 150g",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0
    }
  ],
  "totalCalories": 0,
  "protein": 0,
  "carbs": 0,
  "fat": 0,
  "confidence": 0.9
}

Rules:
- All numeric values must be numbers, not strings.
- confidence is a number from 0 to 1.
- If food is unclear, set confidence to a low value (e.g. 0.3).
- mealName and ingredient names must be in Hebrew.
- Estimate nutrition values based on standard portions visible in the image.
- For every ingredient, quantity is required and should be in grams when possible (e.g. "100 גרם").
- For every ingredient, include calories, protein, carbs, and fat as numeric estimates even if confidence is low.
- Never omit ingredient nutrition fields.`;

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || "";
  if (DEBUG_MEAL_ANALYSIS) {
    console.log("[meal-analysis] raw ai response", raw);
  }

  const cleaned = stripJsonCodeBlock(raw);

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const parseErr = new Error(`AI returned invalid JSON: ${raw.slice(0, 300)}`);
    parseErr.code = "AI_PARSE_ERROR";
    throw parseErr;
  }

  if (DEBUG_MEAL_ANALYSIS) {
    console.log("[meal-analysis] parsed ai analysis", parsed);
  }

  return {
    mealName: String(parsed.mealName || "ארוחה לא מזוהה"),
    ingredients: Array.isArray(parsed.ingredients)
      ? parsed.ingredients.map(normalizeIngredient)
      : [],
    totalCalories: Number(parsed.totalCalories || 0),
    protein: Number(parsed.protein || 0),
    carbs: Number(parsed.carbs || 0),
    fat: Number(parsed.fat || 0),
    confidence: Number(parsed.confidence || 0),
  };
}
