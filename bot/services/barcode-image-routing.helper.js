import { hasExplicitBarcodeIntent } from "./food-product.service.js";

// Pure routing decisions for an incoming WhatsApp image. No I/O, no side
// effects — safe to unit test without touching sockets, Firestore, the
// barcode decoder, or the packaged-product classifier.
export const IMAGE_BARCODE_ROUTES = {
  PRODUCT_FLOW: "product_flow",
  BARCODE_GUIDANCE: "barcode_guidance",
  REQUEST_BARCODE: "request_barcode",
  MEAL_ANALYSIS: "meal_analysis",
};

// Barcode mode is active when the pending state already expects a barcode,
// or the current message explicitly signals barcode intent (by keyword).
export function isBarcodeModeActive({ pendingStep = null, captionText = "" } = {}) {
  return pendingStep === "awaiting_product_barcode" || hasExplicitBarcodeIntent(captionText);
}

/**
 * Routing priority:
 *   1. a decoded barcode always wins -> PRODUCT_FLOW
 *   2. barcode mode active, no decoded barcode -> BARCODE_GUIDANCE
 *   3. packaged-product front image, no barcode -> REQUEST_BARCODE
 *   4/5. ordinary meal or unknown classification -> MEAL_ANALYSIS
 *        (the existing meal-analysis flow owns its own low-confidence /
 *        clarification fallback, so MEAL_OR_FOOD and UNKNOWN both route here)
 */
export function resolveImageBarcodeRouting({
  barcodeFound,
  pendingStep = null,
  captionText = "",
  packagedProductClassification = null,
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

  return IMAGE_BARCODE_ROUTES.MEAL_ANALYSIS;
}
