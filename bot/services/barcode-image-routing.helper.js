import { hasExplicitBarcodeIntent } from "./food-product.service.js";

// Pure routing decisions for an incoming WhatsApp image. No I/O, no side
// effects — safe to unit test without touching sockets, Firestore, the
// barcode decoder, or the packaged-product classifier.
export const IMAGE_BARCODE_ROUTES = {
  PRODUCT_FLOW: "product_flow",
  BARCODE_GUIDANCE: "barcode_guidance",
  REQUEST_BARCODE: "request_barcode",
  MEAL_ANALYSIS: "meal_analysis",
  NON_FOOD: "non_food",
  LOW_CONFIDENCE_FOOD: "low_confidence_food",
};

// Below this confidence, we're not confident enough either way to proceed
// with meal analysis or to flatly reject the image as non-food. Mirrors
// packaged-product-image.service.js's FOOD_IMAGE_MIN_CONFIDENCE (kept as a
// separate constant here so this module stays a pure, dependency-free
// routing helper — see that file for the canonical value it's set from).
export const DEFAULT_FOOD_CONFIDENCE_THRESHOLD = 0.65;

// Barcode mode is active when the pending state already expects a barcode,
// or the current message explicitly signals barcode intent (by keyword).
export function isBarcodeModeActive({ pendingStep = null, captionText = "" } = {}) {
  return pendingStep === "awaiting_product_barcode" || hasExplicitBarcodeIntent(captionText);
}

/**
 * Routing priority:
 *   1. a decoded barcode always wins -> PRODUCT_FLOW (barcode detection is
 *      always the first priority, ahead of any food/non-food judgment)
 *   2. barcode mode active, no decoded barcode -> BARCODE_GUIDANCE
 *   3. packaged-product front image, no barcode -> REQUEST_BARCODE
 *   4. a confident non-food image (isFoodImage === false, i.e. an explicit
 *      model determination, never merely "unknown") -> NON_FOOD
 *   5. an image the classifier isn't confident about either way
 *      (foodConfidence below the threshold) -> LOW_CONFIDENCE_FOOD
 *   6. ordinary meal, unknown classification, or no confidence signal at
 *      all (e.g. the classifier itself failed) -> MEAL_ANALYSIS
 *      (the existing meal-analysis flow owns its own low-confidence /
 *      clarification fallback, so this remains the safe default)
 */
export function resolveImageBarcodeRouting({
  barcodeFound,
  pendingStep = null,
  captionText = "",
  packagedProductClassification = null,
  isFoodImage = null,
  foodConfidence = null,
  foodConfidenceThreshold = DEFAULT_FOOD_CONFIDENCE_THRESHOLD,
} = {}) {
  if (barcodeFound) {
    return IMAGE_BARCODE_ROUTES.PRODUCT_FLOW;
  }

  if (isBarcodeModeActive({ pendingStep, captionText })) {
    return IMAGE_BARCODE_ROUTES.BARCODE_GUIDANCE;
  }

  if (packagedProductClassification === "PACKAGED_PRODUCT") {
    return IMAGE_BARCODE_ROUTES.REQUEST_BARCODE;
  }

  if (isFoodImage === false) {
    return IMAGE_BARCODE_ROUTES.NON_FOOD;
  }

  if (typeof foodConfidence === "number" && Number.isFinite(foodConfidence) && foodConfidence < foodConfidenceThreshold) {
    return IMAGE_BARCODE_ROUTES.LOW_CONFIDENCE_FOOD;
  }

  return IMAGE_BARCODE_ROUTES.MEAL_ANALYSIS;
}
