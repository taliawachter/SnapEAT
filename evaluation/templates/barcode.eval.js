// Evaluation template: Barcode
//
// Exercises the real deterministic barcode-flow logic: quantity/fraction
// parsing from free Hebrew text, and routing between meal-analysis,
// barcode-guidance, and product flows. No network or model calls — this
// entire flow is deterministic by design (see TEST_AUDIT.md), so every case
// here runs in "fixture" mode and is safe to run anywhere, always.
import { parseProductAmountInput } from "../../bot/services/product-amount.helper.js";
import {
  resolveImageBarcodeRouting,
  IMAGE_BARCODE_ROUTES,
} from "../../bot/services/barcode-image-routing.helper.js";
import { runEvaluationSuite } from "../lib/evaluation-runner.js";

const quantityRubric = [
  { text: "150 גרם", expectGrams: 150 },
  { text: "חצי אריזה", expectFraction: 0.5 },
  { text: "רבע אריזה", expectFraction: 0.25 },
  { text: "אריזה שלמה", expectFraction: 1 },
  { text: "כפית", expectNoGramsGuess: true }, // unverified unit, must not guess grams
];

const cases = [
  {
    name: "Hebrew quantity parsing matches expected grams/fractions across a labeled rubric",
    run: () => quantityRubric.map((c) => ({ ...c, result: parseProductAmountInput(c.text) })),
    judge: (rows) => {
      const failures = rows.filter((row) => {
        if (row.expectGrams != null) return row.result?.grams !== row.expectGrams;
        if (row.expectFraction != null) return row.result?.fraction !== row.expectFraction;
        if (row.expectNoGramsGuess) return row.result?.type === "grams";
        return false;
      });
      return {
        verdict: failures.length === 0 ? "PASS" : "FAIL",
        score: (rubricScore(rows.length, failures.length)),
        notes:
          failures.length === 0
            ? `All ${rows.length} quantity phrases parsed as expected.`
            : `Mismatched: ${failures.map((f) => f.text).join(", ")}`,
      };
    },
  },
  {
    name: "a decoded barcode always wins routing, even mid-clarification",
    run: () =>
      resolveImageBarcodeRouting({ barcodeFound: true, pendingStep: "awaiting_clarification", captionText: "" }),
    judge: (route) => ({
      verdict: route === IMAGE_BARCODE_ROUTES.PRODUCT_FLOW ? "PASS" : "FAIL",
      score: route === IMAGE_BARCODE_ROUTES.PRODUCT_FLOW ? 1 : 0,
      notes: `Routed to ${route}; a real decoded barcode must never be dropped in favor of another pending flow.`,
    }),
  },
  {
    name: "a packaged-product image with no barcode asks the user for the barcode instead of guessing nutrition",
    run: () =>
      resolveImageBarcodeRouting({
        barcodeFound: false,
        pendingStep: null,
        captionText: "",
        packagedProductClassification: "PACKAGED_PRODUCT",
      }),
    judge: (route) => ({
      verdict: route === IMAGE_BARCODE_ROUTES.REQUEST_BARCODE ? "PASS" : "FAIL",
      score: route === IMAGE_BARCODE_ROUTES.REQUEST_BARCODE ? 1 : 0,
      notes: `Routed to ${route}; packaged products without a scanned barcode must be asked for one, not analyzed as a generic meal.`,
    }),
  },
  {
    name: "an ordinary meal photo is never misrouted into the barcode flow",
    run: () =>
      resolveImageBarcodeRouting({
        barcodeFound: false,
        pendingStep: null,
        captionText: "ארוחת צהריים שלי",
        packagedProductClassification: "MEAL_OR_FOOD",
      }),
    judge: (route) => ({
      verdict: route === IMAGE_BARCODE_ROUTES.MEAL_ANALYSIS ? "PASS" : "FAIL",
      score: route === IMAGE_BARCODE_ROUTES.MEAL_ANALYSIS ? 1 : 0,
      notes: `Routed to ${route}.`,
    }),
  },
];

function rubricScore(total, failed) {
  return total ? Math.round(((total - failed) / total) * 100) / 100 : 0;
}

export async function runSuite() {
  return runEvaluationSuite("Barcode", cases);
}
