import OpenAI from "openai";
import { NUTRITION_SYSTEM_INSTRUCTIONS, buildNutritionContextBlock } from "./nutrition-instructions.js";

const SAFE_DEFAULT_MAX_RESULTS = 5;
const SAFE_MAX_RESULTS_CAP = 20;
const SAFE_FALLBACK_HEBREW = "כרגע לא הצלחתי לגשת למקורות המידע המאומתים, ולכן אני לא רוצה לתת תשובה שעלולה להיות לא מדויקת. אפשר לנסות שוב מאוחר יותר, ובשאלה רפואית או אישית מומלץ לפנות לאיש מקצוע מוסמך.";
const VERIFIED_INFO_UNAVAILABLE_HEBREW = "אין לי כרגע מספיק מידע מאומת במאגר כדי לענות על החלק הזה במדויק.";
const EXTREME_WEIGHT_LOSS_SAFE_HEBREW = "ירידה קיצונית ומהירה במשקל עלולה להיות לא בטוחה. מומלץ להתמקד בשינויים הדרגתיים ולהתייעץ עם דיאטנית או רופא לצורך התאמה אישית.";
const GENERAL_EXAMPLE_ONLY_HEBREW = "אני יכולה לתת דוגמה כללית בלבד. לתוכנית אישית צריך לפנות לדיאטנית רשומה.";

let singletonClient = null;

function getOpenAIClient(apiKey) {
  if (!singletonClient) {
    singletonClient = new OpenAI({ apiKey });
  }
  return singletonClient;
}

function parseMaxResults(rawValue) {
  if (rawValue === undefined || rawValue === null) return SAFE_DEFAULT_MAX_RESULTS;
  const asText = String(rawValue).trim();
  if (!asText) return SAFE_DEFAULT_MAX_RESULTS;
  const parsed = Number(asText);
  if (!Number.isFinite(parsed)) return SAFE_DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(SAFE_MAX_RESULTS_CAP, Math.floor(parsed)));
}

function normalizeString(value = "") {
  return String(value || "").trim();
}

function extractAnswerFromResponse(response) {
  const direct = normalizeString(response?.output_text);
  if (direct) return direct;

  const outputItems = Array.isArray(response?.output) ? response.output : [];
  for (const item of outputItems) {
    if (item?.type !== "message") continue;
    const contentItems = Array.isArray(item?.content) ? item.content : [];
    for (const contentItem of contentItems) {
      if (contentItem?.type === "output_text") {
        const text = normalizeString(contentItem?.text);
        if (text) return text;
      }
    }
  }

  return "";
}

function extractCitations(response) {
  const citations = [];
  const seen = new Set();
  const outputItems = Array.isArray(response?.output) ? response.output : [];

  for (const item of outputItems) {
    if (item?.type !== "message") continue;
    const contentItems = Array.isArray(item?.content) ? item.content : [];

    for (const contentItem of contentItems) {
      if (contentItem?.type !== "output_text") continue;
      const annotations = Array.isArray(contentItem?.annotations) ? contentItem.annotations : [];

      for (const annotation of annotations) {
        if (!annotation || typeof annotation !== "object") continue;

        const isFileCitation = annotation.type === "file_citation";
        const isContainerCitation = annotation.type === "container_file_citation";
        if (!isFileCitation && !isContainerCitation) continue;

        const fileId = normalizeString(annotation?.file_id);
        const filename = normalizeString(annotation?.filename);
        const index = Number.isFinite(Number(annotation?.index)) ? Number(annotation.index) : null;

        const key = [annotation.type, fileId, filename, index ?? ""].join("|");
        if (seen.has(key)) continue;
        seen.add(key);

        citations.push({
          type: annotation.type,
          fileId: fileId || null,
          filename: filename || null,
          index,
        });
      }
    }
  }

  return citations;
}

function extractRetrievedSourceText(response) {
  const outputItems = Array.isArray(response?.output) ? response.output : [];
  const parts = [];

  for (const item of outputItems) {
    if (item?.type !== "file_search_call") continue;
    const results = Array.isArray(item?.results) ? item.results : [];

    for (const result of results) {
      const content = result?.content;

      if (typeof content === "string" && content.trim()) {
        parts.push(content);
        continue;
      }

      if (Array.isArray(content)) {
        for (const chunk of content) {
          if (typeof chunk === "string" && chunk.trim()) {
            parts.push(chunk);
            continue;
          }
          if (chunk && typeof chunk === "object") {
            const chunkText = normalizeString(chunk?.text || chunk?.value || "");
            if (chunkText) parts.push(chunkText);
          }
        }
      }
    }
  }

  return parts.join("\n");
}

function normalizeNumericText(value = "") {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/,/g, ".")
    .replace(/[–—]/g, "-")
    .trim();
}

function extractNumericClaims(text = "") {
  const input = String(text || "");
  const matches = input.match(/\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?/g);
  return Array.isArray(matches) ? matches : [];
}

function hasUnsupportedNumericClaim(answer, retrievedSourceText) {
  const claims = extractNumericClaims(answer);
  if (!claims.length) return false;

  const corpus = normalizeNumericText(retrievedSourceText);
  if (!corpus) return true;

  return claims.some((claim) => !corpus.includes(normalizeNumericText(claim)));
}

function isExtremeWeightLossQuestion(question = "") {
  const q = normalizeString(question).toLowerCase();
  const hasWeightLossIntent = q.includes("ירידה") || q.includes("לרדת") || q.includes("weight loss") || q.includes("lose weight");
  const hasExtremeSignal = q.includes("מהר")
    || q.includes("מהירה")
    || q.includes("קיצונ")
    || q.includes("drastic")
    || q.includes("rapid")
    || q.includes("כמה בשבוע")
    || q.includes("כמה קילו");

  return hasWeightLossIntent && hasExtremeSignal;
}

function sanitizeLanguageQuality(answer = "") {
  return String(answer || "")
    .replace(/\bSugar\b/gi, "סוכר")
    .replace(/\bProtein\b/gi, "חלבון")
    .replace(/\bCarbs\b/gi, "פחמימות")
    .replace(/\bCalories\b/gi, "קלוריות")
    .replace(/\bFat\b/gi, "שומן")
    .trim();
}

function removePersonalizedMealPlanOffer(answer = "") {
  const text = String(answer || "").trim();
  const planOfferPattern = /(תפריט אישי|תוכנית אישית|meal plan|personalized plan|plan for you)/i;
  if (!planOfferPattern.test(text)) return text;
  return GENERAL_EXAMPLE_ONLY_HEBREW;
}

function buildNutritionInput({ question, userProfileSummary, memorySummary, mealInfoSummary }) {
  return [
    {
      role: "user",
      content: [
        "[USER QUESTION]",
        question,
        "",
        buildNutritionContextBlock({
          userProfileSummary,
          memorySummary,
          mealInfoSummary,
        }),
      ].join("\n"),
    },
  ];
}

export async function getNutritionKnowledgeAnswer({
  question,
  userProfileSummary = "",
  memorySummary = "",
  mealInfoSummary = "",
  openaiClient = null,
  env = process.env,
  model = "",
} = {}) {
  const normalizedQuestion = normalizeString(question);
  const apiKey = normalizeString(env?.OPENAI_API_KEY);
  const vectorStoreId = normalizeString(env?.OPENAI_VECTOR_STORE_ID);
  const resolvedModel = normalizeString(model || env?.OPENAI_MODEL);
  const maxResults = parseMaxResults(env?.OPENAI_FILE_SEARCH_MAX_RESULTS);

  if (!normalizedQuestion) {
    return {
      answer: "",
      responseId: null,
      sourceType: "OPENAI_FILE_SEARCH",
      citations: [],
      usedFallback: false,
      shouldUseDefaultFlow: true,
      errorCode: "BLANK_QUESTION",
    };
  }

  if (!apiKey) {
    return {
      answer: SAFE_FALLBACK_HEBREW,
      responseId: null,
      sourceType: "OPENAI_FILE_SEARCH",
      citations: [],
      usedFallback: true,
      shouldUseDefaultFlow: false,
      errorCode: "OPENAI_API_KEY_MISSING",
    };
  }

  if (!vectorStoreId) {
    return {
      answer: SAFE_FALLBACK_HEBREW,
      responseId: null,
      sourceType: "OPENAI_FILE_SEARCH",
      citations: [],
      usedFallback: true,
      shouldUseDefaultFlow: false,
      errorCode: "OPENAI_VECTOR_STORE_ID_MISSING",
    };
  }

  if (!resolvedModel) {
    return {
      answer: SAFE_FALLBACK_HEBREW,
      responseId: null,
      sourceType: "OPENAI_FILE_SEARCH",
      citations: [],
      usedFallback: true,
      shouldUseDefaultFlow: false,
      errorCode: "OPENAI_MODEL_MISSING",
    };
  }

  try {
    const client = openaiClient || getOpenAIClient(apiKey);

    const response = await client.responses.create({
      model: resolvedModel,
      instructions: NUTRITION_SYSTEM_INSTRUCTIONS,
      input: buildNutritionInput({
        question: normalizedQuestion,
        userProfileSummary,
        memorySummary,
        mealInfoSummary,
      }),
      include: ["file_search_call.results"],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [vectorStoreId],
          max_num_results: maxResults,
        },
      ],
    });

    const answer = extractAnswerFromResponse(response);
    const citations = extractCitations(response);
    const retrievedSourceText = extractRetrievedSourceText(response);

    if (!answer) {
      return {
        answer: "אין לי כרגע מספיק מידע מאומת כדי לענות בביטחון. אפשר לנסח את השאלה מחדש או לפנות לאיש מקצוע מוסמך.",
        responseId: normalizeString(response?.id) || null,
        sourceType: "OPENAI_FILE_SEARCH",
        citations,
        usedFallback: true,
        shouldUseDefaultFlow: false,
        errorCode: "EMPTY_OPENAI_RESPONSE",
      };
    }

    const normalizedAnswer = removePersonalizedMealPlanOffer(sanitizeLanguageQuality(answer));
    const noVerifiedSource = citations.length === 0;
    const unsupportedNumericClaim = hasUnsupportedNumericClaim(normalizedAnswer, retrievedSourceText);
    const isExtremeQuestion = isExtremeWeightLossQuestion(normalizedQuestion);

    if (noVerifiedSource || unsupportedNumericClaim) {
      const groundedFallback = isExtremeQuestion
        ? EXTREME_WEIGHT_LOSS_SAFE_HEBREW
        : VERIFIED_INFO_UNAVAILABLE_HEBREW;

      return {
        answer: groundedFallback,
        responseId: normalizeString(response?.id) || null,
        sourceType: "OPENAI_FILE_SEARCH",
        citations,
        usedFallback: true,
        shouldUseDefaultFlow: false,
        errorCode: noVerifiedSource ? "NO_VERIFIED_CITATIONS" : "UNSUPPORTED_NUMERIC_CLAIM",
      };
    }

    return {
      answer: normalizedAnswer,
      responseId: normalizeString(response?.id) || null,
      sourceType: "OPENAI_FILE_SEARCH",
      citations,
      usedFallback: false,
      shouldUseDefaultFlow: false,
      errorCode: null,
    };
  } catch (error) {
    console.log("NUTRITION KNOWLEDGE SERVICE FAILED", {
      code: error?.code || "OPENAI_API_ERROR",
      message: "request_failed",
    });

    return {
      answer: SAFE_FALLBACK_HEBREW,
      responseId: null,
      sourceType: "OPENAI_FILE_SEARCH",
      citations: [],
      usedFallback: true,
      shouldUseDefaultFlow: false,
      errorCode: "OPENAI_API_ERROR",
    };
  }
}
