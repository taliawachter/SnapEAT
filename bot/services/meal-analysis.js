import fs from "fs";
import path from "path";
import OpenAI from "openai";
import {
  mealAnalysisNeedsClarification,
  mealAnalysisNeedsRepair,
  mergeMissingMealAnalysisFields,
  normalizeMealAnalysis,
} from "../../shared/meal-analysis.js";

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

function parseJsonResponse(raw = "") {
  const cleaned = stripJsonCodeBlock(raw);
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function buildAnalysisPrompt(userNote = "") {
  return `
Analyze the food image and return ONLY valid JSON.

Schema:
{
  "mealName": "string in Hebrew",
  "description": "short Hebrew description",
  "totalEstimatedQuantityGrams": 0,
  "totalCalories": 0,
  "totalProteinGrams": 0,
  "totalCarbohydratesGrams": 0,
  "totalFatGrams": 0,
  "confidence": 0.85,
  "estimationNotes": ["short note"],
  "needsClarification": false,
  "clarificationQuestion": null,
  "ingredients": [
    {
      "name": "string in Hebrew",
      "estimatedQuantity": "human readable portion in Hebrew",
      "estimatedQuantityGrams": 0,
      "calories": 0,
      "proteinGrams": 0,
      "carbohydratesGrams": 0,
      "fatGrams": 0,
      "confidence": 0.8
    }
  ]
}

Rules:
- Output JSON only.
- Use approximate quantities when exact grams are uncertain.
- Never use strings like "לא זמין" in numeric fields.
- If you cannot know an exact quantity, still estimate a portion such as bowl, spoon, count, slice, roll, or unit.
- If confidence is too low for a meaningful estimate, set needsClarification=true and add one short Hebrew clarificationQuestion.
- estimationNotes should be short and factual.
- Meal name and ingredient names must be Hebrew.

User note: ${userNote || "אין הערת משתמש."}
`.trim();
}

function buildRepairPrompt(analysis) {
  return `
Repair only missing or weak nutrition estimate fields for this already-identified meal.
Return ONLY valid JSON using the same schema.

Keep existing strong fields consistent.
Focus on filling missing quantities, grams, calories, protein, carbohydrates, fat, and totals.
Use approximate portions if needed.

Existing analysis:
${JSON.stringify(analysis, null, 2)}
`.trim();
}

async function callStructuredMealAnalysis({ dataUrl, prompt }) {
  const client = getClient();
  if (!client) {
    const err = new Error("AI analysis is not configured");
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meal_analysis",
        schema: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
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

  return String(resp.choices?.[0]?.message?.content || "").trim();
}

function withClarificationMetadata(analysis, raw = {}) {
  return {
    ...analysis,
    needsClarification: Boolean(raw?.needsClarification) || mealAnalysisNeedsClarification(analysis),
    clarificationQuestion:
      typeof raw?.clarificationQuestion === "string" && raw.clarificationQuestion.trim()
        ? raw.clarificationQuestion.trim()
        : null,
  };
}

export async function analyzeMealDataUrl(dataUrl, userNote = "") {
  try {
    console.log("MEAL ANALYSIS STARTED", {
      ingredientCount: 0,
    });

    const raw = await callStructuredMealAnalysis({
      dataUrl,
      prompt: buildAnalysisPrompt(userNote),
    });

    const parsed = parseJsonResponse(raw);
    if (!parsed) {
      const parseErr = new Error(`AI returned invalid JSON: ${raw.slice(0, 300)}`);
      parseErr.code = "AI_PARSE_ERROR";
      throw parseErr;
    }

    let normalized = withClarificationMetadata(normalizeMealAnalysis(parsed), parsed);

    console.log("MEAL ANALYSIS PARSED", {
      ingredientCount: normalized.ingredients.length,
      confidence: normalized.confidence,
    });

    if (mealAnalysisNeedsRepair(normalized)) {
      console.log("MEAL ANALYSIS REPAIR STARTED", {
        ingredientCount: normalized.ingredients.length,
        confidence: normalized.confidence,
      });

      const repairRaw = await callStructuredMealAnalysis({
        dataUrl,
        prompt: buildRepairPrompt(normalized),
      });
      const repairParsed = parseJsonResponse(repairRaw);
      if (repairParsed) {
        normalized = withClarificationMetadata(
          mergeMissingMealAnalysisFields(normalized, repairParsed),
          repairParsed,
        );
        console.log("MEAL ANALYSIS REPAIR COMPLETED", {
          ingredientCount: normalized.ingredients.length,
          confidence: normalized.confidence,
        });
      }
    }

    const warnings = [];
    if (!normalized.totalCalories && normalized.ingredients.length) {
      warnings.push("missing_total_calories");
    }
    if (normalized.confidence < 0.45) {
      warnings.push("low_confidence");
    }
    if (warnings.length) {
      console.log("MEAL ANALYSIS VALIDATION WARNING", {
        ingredientCount: normalized.ingredients.length,
        confidence: normalized.confidence,
        warnings,
      });
    }

    return normalized;
  } catch (error) {
    console.log("MEAL ANALYSIS FAILED", {
      error: error?.message || error,
    });
    throw error;
  }
}

export async function repairMealAnalysisFromClarification(analysis, clarificationAnswer) {
  const normalized = normalizeMealAnalysis(analysis);
  const client = getClient();

  if (!client) {
    const err = new Error("AI analysis is not configured");
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }

  const prompt = `
Refine this meal analysis using the user's clarification.
Return ONLY valid JSON using the same schema as before.

Existing analysis:
${JSON.stringify(normalized, null, 2)}

User clarification:
${clarificationAnswer}
`.trim();

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const raw = String(resp.choices?.[0]?.message?.content || "").trim();
  const parsed = parseJsonResponse(raw);
  if (!parsed) return normalized;

  return withClarificationMetadata(mergeMissingMealAnalysisFields(normalized, parsed), parsed);
}

export async function analyzeMealImage(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase().replace(".", "") || "jpeg";
  const mimeType =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  return analyzeMealDataUrl(dataUrl);
}
