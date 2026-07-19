// Evaluation template: Meal Analysis
//
// Exercises the REAL, unmodified shared/meal-analysis.js normalizer and
// clarification-detection logic used by both the WhatsApp bot and the web
// API route (POST /api/meals/analyze). Cases run in "fixture" mode by
// default (no network calls) using canned model-shaped JSON as the input to
// normalizeMealAnalysis, so this suite is always safe to run in CI.
//
// TO EVALUATE THE LIVE MODEL: replace `runFixtureAnalysis` below with a call
// to bot/services/meal-analysis.js's analyzeMealImage(imagePath) against a
// real photo, and set `mode: "live"` on that case. Requires OPENAI_API_KEY.
import {
  normalizeMealAnalysis,
  mealAnalysisNeedsClarification,
} from "../../shared/meal-analysis.js";
import { runEvaluationSuite } from "../lib/evaluation-runner.js";

function runFixtureAnalysis(rawModelJson) {
  return normalizeMealAnalysis(rawModelJson);
}

const cases = [
  {
    name: "never reports negative calories or macros regardless of malformed model output",
    run: () => runFixtureAnalysis({ totalCalories: -120, totalProteinGrams: -5, ingredients: [] }),
    judge: (result) => {
      const clean = result.totalCalories >= 0 && result.totalProteinGrams >= 0;
      return {
        verdict: clean ? "PASS" : "FAIL",
        score: clean ? 1 : 0,
        notes: clean
          ? "Negative model output was normalized to non-negative totals."
          : `Negative values leaked through: totalCalories=${result.totalCalories}, totalProteinGrams=${result.totalProteinGrams}`,
      };
    },
  },
  {
    name: "flags a low-confidence, low-calorie analysis as needing clarification",
    run: () =>
      mealAnalysisNeedsClarification({
        confidence: 0.2,
        totalCalories: 0,
        ingredients: [{ name: "?" }],
      }),
    judge: (needsClarification) => ({
      verdict: needsClarification ? "PASS" : "FAIL",
      score: needsClarification ? 1 : 0,
      notes: needsClarification
        ? "Low-confidence/zero-calorie analysis correctly triggers a clarification prompt."
        : "A clearly uncertain analysis was NOT flagged for clarification — risk of silently wrong nutrition data.",
    }),
  },
  {
    name: "does not flag a complete, high-confidence analysis for clarification",
    run: () =>
      mealAnalysisNeedsClarification({
        confidence: 0.9,
        totalCalories: 450,
        ingredients: [
          { name: "עוף", estimatedQuantityGrams: 150, calories: 250, proteinGrams: 40, carbohydratesGrams: 0, fatGrams: 8 },
          { name: "אורז", estimatedQuantityGrams: 150, calories: 200, proteinGrams: 4, carbohydratesGrams: 45, fatGrams: 1 },
        ],
      }),
    judge: (needsClarification) => ({
      verdict: !needsClarification ? "PASS" : "WARN",
      score: !needsClarification ? 1 : 0.5,
      notes: !needsClarification
        ? "Confident, complete analysis is not unnecessarily interrupted with a clarification question."
        : "A complete, high-confidence analysis was flagged for clarification — may create unnecessary user friction.",
    }),
  },
  {
    name: "an empty/garbage model response degrades to a labeled unknown estimate instead of fabricating data",
    run: () => runFixtureAnalysis({}),
    judge: (result) => {
      const isHonestAboutUnknown =
        result.totalCalories === 0 &&
        result.ingredients.length === 0 &&
        result.estimationNotes.length > 0;
      return {
        verdict: isHonestAboutUnknown ? "PASS" : "FAIL",
        score: isHonestAboutUnknown ? 1 : 0,
        notes: isHonestAboutUnknown
          ? "Empty model output is surfaced honestly as an unknown estimate, not invented numbers."
          : "Empty model output did not produce the expected 'unknown estimate' signal.",
      };
    },
  },
  {
    name: "[live-capable, fixture-mode] a realistic complete analysis round-trips with correct total math",
    mode: "fixture",
    run: () =>
      runFixtureAnalysis({
        mealName: "סלט עוף",
        ingredients: [
          { name: "עוף", estimatedQuantityGrams: 150, calories: 250, proteinGrams: 40, carbohydratesGrams: 0, fatGrams: 8 },
          { name: "ירקות", estimatedQuantityGrams: 200, calories: 60, proteinGrams: 3, carbohydratesGrams: 10, fatGrams: 1 },
        ],
        confidence: 0.9,
      }),
    judge: (result) => {
      const expectedCalories = 310;
      const withinTolerance = Math.abs(result.totalCalories - expectedCalories) <= 5;
      return {
        verdict: withinTolerance ? "PASS" : "FAIL",
        score: withinTolerance ? 1 : 0,
        notes: `Computed totalCalories=${result.totalCalories}, expected ~${expectedCalories} from ingredient sum.`,
      };
    },
  },
];

export async function runSuite() {
  return runEvaluationSuite("Meal Analysis", cases);
}
