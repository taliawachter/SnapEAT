// Evaluation template: Cross-Platform Consistency (Web <-> WhatsApp)
//
// SNAP EAT stores every meal once but renders it two ways: WhatsApp gets a
// legacy Hebrew text block (canonicalAnalysisToLegacyText), while the web
// app reads structured fields (normalizeMealRecordForDisplay, which can
// also parse the legacy text back out for meals that only have it). This
// suite round-trips real meal data through both directions using the real,
// unmodified shared/meal-analysis.js — the exact module both platforms
// import — to catch drift between what a WhatsApp user sees and what the
// same meal looks like in the web journal. Fully deterministic.
import {
  normalizeMealAnalysis,
  canonicalAnalysisToLegacyText,
  normalizeMealRecordForDisplay,
} from "../../shared/meal-analysis.js";
import { runEvaluationSuite } from "../lib/evaluation-runner.js";

const canonicalMeal = {
  mealName: "סלט עוף",
  ingredients: [
    { name: "חזה עוף", estimatedQuantityGrams: 150, calories: 250, proteinGrams: 40, carbohydratesGrams: 0, fatGrams: 8 },
    { name: "ירקות", estimatedQuantityGrams: 200, calories: 60, proteinGrams: 3, carbohydratesGrams: 10, fatGrams: 1 },
  ],
  confidence: 0.9,
};

const cases = [
  {
    name: "WhatsApp legacy text round-trips back to the same total calories the web app would show",
    run: () => {
      const canonical = normalizeMealAnalysis(canonicalMeal);
      const legacyText = canonicalAnalysisToLegacyText(canonical);
      // Simulate a web read of a meal that only has WhatsApp's legacy text
      // stored (older schema / bot-only save path).
      const webView = normalizeMealRecordForDisplay({ analysisText: legacyText });
      return { canonical, legacyText, webView };
    },
    judge: ({ canonical, webView }) => {
      const match = webView.totalCalories === canonical.totalCalories;
      return {
        verdict: match ? "PASS" : "FAIL",
        score: match ? 1 : 0,
        notes: match
          ? `Both platforms agree on totalCalories=${canonical.totalCalories}.`
          : `Drift detected: WhatsApp-authored value ${canonical.totalCalories} vs. web-parsed value ${webView.totalCalories}.`,
      };
    },
  },
  {
    name: "the meal name survives the WhatsApp text round-trip unchanged",
    run: () => {
      const canonical = normalizeMealAnalysis(canonicalMeal);
      const legacyText = canonicalAnalysisToLegacyText(canonical);
      const webView = normalizeMealRecordForDisplay({ analysisText: legacyText });
      return { canonical, webView };
    },
    judge: ({ canonical, webView }) => {
      const match = webView.mealName === canonical.mealName;
      return {
        verdict: match ? "PASS" : "FAIL",
        score: match ? 1 : 0,
        notes: match
          ? `mealName "${canonical.mealName}" preserved across platforms.`
          : `mealName drifted: "${canonical.mealName}" -> "${webView.mealName}".`,
      };
    },
  },
  {
    name: "a meal saved with BOTH structured fields and legacy text (web save path) prefers the structured data",
    run: () => {
      const canonical = normalizeMealAnalysis(canonicalMeal);
      const legacyText = canonicalAnalysisToLegacyText(
        normalizeMealAnalysis({ ...canonicalMeal, totalCalories: 999 }) // deliberately mismatched legacy text
      );
      const webView = normalizeMealRecordForDisplay({
        analysis: canonical,
        analysisText: legacyText,
      });
      return { canonical, webView };
    },
    judge: ({ canonical, webView }) => {
      const preferredStructured = webView.totalCalories === canonical.totalCalories;
      return {
        verdict: preferredStructured ? "PASS" : "WARN",
        score: preferredStructured ? 1 : 0.5,
        notes: preferredStructured
          ? "Structured `analysis` data takes precedence over a stale legacy text block, as intended."
          : `Expected structured totalCalories=${canonical.totalCalories} to win, got ${webView.totalCalories} from stale legacy text.`,
      };
    },
  },
  {
    name: "macro totals (protein/carbs/fat) are consistent across both renderings, not just calories",
    run: () => {
      const canonical = normalizeMealAnalysis(canonicalMeal);
      const legacyText = canonicalAnalysisToLegacyText(canonical);
      const webView = normalizeMealRecordForDisplay({ analysisText: legacyText });
      return { canonical, webView };
    },
    judge: ({ canonical, webView }) => {
      const fields = ["totalProteinGrams", "totalCarbohydratesGrams", "totalFatGrams"];
      const mismatched = fields.filter((f) => webView[f] !== canonical[f]);
      return {
        verdict: mismatched.length === 0 ? "PASS" : "FAIL",
        score: mismatched.length === 0 ? 1 : Math.round(((fields.length - mismatched.length) / fields.length) * 100) / 100,
        notes:
          mismatched.length === 0
            ? "protein/carbs/fat all match between WhatsApp text and web parsing."
            : `Mismatched macros: ${mismatched.join(", ")}`,
      };
    },
  },
];

export async function runSuite() {
  return runEvaluationSuite("Cross Platform", cases);
}
