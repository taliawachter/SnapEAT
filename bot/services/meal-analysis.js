import fs from "fs";
import path from "path";
import OpenAI from "openai";

let _client = null;

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
  return {
    name: String(item?.name || "רכיב"),
    quantity: String(item?.quantity || ""),
    calories: Number(item?.calories || 0),
    protein: Number(item?.protein || 0),
    carbs: Number(item?.carbs || 0),
    fat: Number(item?.fat || 0),
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
- Estimate nutrition values based on standard portions visible in the image.`;

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
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
  const cleaned = stripJsonCodeBlock(raw);

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const parseErr = new Error(`AI returned invalid JSON: ${raw.slice(0, 300)}`);
    parseErr.code = "AI_PARSE_ERROR";
    throw parseErr;
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
