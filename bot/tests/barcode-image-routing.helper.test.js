import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveImageBarcodeRouting,
  isBarcodeModeActive,
  IMAGE_BARCODE_ROUTES,
} from "../services/barcode-image-routing.helper.js";

// ordinary meal image + no barcode found -> no barcode-failure message, meal analysis continues
test("routes an ordinary meal photo with no barcode intent to meal analysis", () => {
  const route = resolveImageBarcodeRouting({
    barcodeFound: false,
    pendingStep: null,
    captionText: "ארוחת צהריים שלי",
  });

  assert.equal(route, IMAGE_BARCODE_ROUTES.MEAL_ANALYSIS);
});

test("routes a captionless meal photo with no pending barcode state to meal analysis", () => {
  const route = resolveImageBarcodeRouting({
    barcodeFound: false,
    pendingStep: null,
    captionText: "",
  });

  assert.equal(route, IMAGE_BARCODE_ROUTES.MEAL_ANALYSIS);
});

// barcode-intent image + no barcode found -> barcode guidance shown
test("routes to barcode guidance when the caption explicitly signals barcode intent", () => {
  const route = resolveImageBarcodeRouting({
    barcodeFound: false,
    pendingStep: null,
    captionText: "צילום ברקוד",
  });

  assert.equal(route, IMAGE_BARCODE_ROUTES.BARCODE_GUIDANCE);
});

test("routes to barcode guidance for other explicit barcode-intent captions", () => {
  for (const captionText of ["ברקוד", "סריקה", "סרקתי", "תזהה לפי ברקוד"]) {
    const route = resolveImageBarcodeRouting({ barcodeFound: false, pendingStep: null, captionText });
    assert.equal(route, IMAGE_BARCODE_ROUTES.BARCODE_GUIDANCE, `expected guidance for "${captionText}"`);
  }
});

// awaiting_product_barcode + no barcode found -> barcode guidance shown
test("routes to barcode guidance when the pending state already expects a barcode", () => {
  const route = resolveImageBarcodeRouting({
    barcodeFound: false,
    pendingStep: "awaiting_product_barcode",
    captionText: "",
  });

  assert.equal(route, IMAGE_BARCODE_ROUTES.BARCODE_GUIDANCE);
});

// valid barcode detected -> product flow selected
test("routes to the product flow whenever a barcode was actually decoded, regardless of intent or pending state", () => {
  const route = resolveImageBarcodeRouting({
    barcodeFound: true,
    pendingStep: null,
    captionText: "ארוחת צהריים שלי",
  });

  assert.equal(route, IMAGE_BARCODE_ROUTES.PRODUCT_FLOW);
});

test("a found barcode always wins over any other pending state", () => {
  const route = resolveImageBarcodeRouting({
    barcodeFound: true,
    pendingStep: "awaiting_clarification",
    captionText: "",
  });

  assert.equal(route, IMAGE_BARCODE_ROUTES.PRODUCT_FLOW);
});

test("a found barcode always wins over a packaged-product classification too", () => {
  const route = resolveImageBarcodeRouting({
    barcodeFound: true,
    pendingStep: null,
    captionText: "",
    packagedProductClassification: "PACKAGED_PRODUCT",
  });

  assert.equal(route, IMAGE_BARCODE_ROUTES.PRODUCT_FLOW);
});

// packaged-product front image + no barcode -> barcode request shown
test("routes a packaged-product front image with no barcode to REQUEST_BARCODE", () => {
  const route = resolveImageBarcodeRouting({
    barcodeFound: false,
    pendingStep: null,
    captionText: "",
    packagedProductClassification: "PACKAGED_PRODUCT",
  });

  assert.equal(route, IMAGE_BARCODE_ROUTES.REQUEST_BARCODE);
});

test("barcode mode takes priority over a packaged-product classification", () => {
  const route = resolveImageBarcodeRouting({
    barcodeFound: false,
    pendingStep: "awaiting_product_barcode",
    captionText: "",
    packagedProductClassification: "PACKAGED_PRODUCT",
  });

  assert.equal(route, IMAGE_BARCODE_ROUTES.BARCODE_GUIDANCE);
});

// unknown classification -> existing fallback (same route as an ordinary meal)
test("routes an UNKNOWN classification to the existing meal-analysis fallback", () => {
  const route = resolveImageBarcodeRouting({
    barcodeFound: false,
    pendingStep: null,
    captionText: "",
    packagedProductClassification: "UNKNOWN",
  });

  assert.equal(route, IMAGE_BARCODE_ROUTES.MEAL_ANALYSIS);
});

test("routes a MEAL_OR_FOOD classification to meal analysis", () => {
  const route = resolveImageBarcodeRouting({
    barcodeFound: false,
    pendingStep: null,
    captionText: "",
    packagedProductClassification: "MEAL_OR_FOOD",
  });

  assert.equal(route, IMAGE_BARCODE_ROUTES.MEAL_ANALYSIS);
});

test("isBarcodeModeActive is true for the awaiting_product_barcode pending step", () => {
  assert.equal(isBarcodeModeActive({ pendingStep: "awaiting_product_barcode", captionText: "" }), true);
});

test("isBarcodeModeActive is true for explicit barcode-intent captions", () => {
  assert.equal(isBarcodeModeActive({ pendingStep: null, captionText: "אני שולחת ברקוד" }), true);
  assert.equal(isBarcodeModeActive({ pendingStep: null, captionText: "סריקת ברקוד" }), true);
});

test("isBarcodeModeActive is false for an ordinary caption and no pending barcode state", () => {
  assert.equal(isBarcodeModeActive({ pendingStep: null, captionText: "ארוחת צהריים" }), false);
  assert.equal(isBarcodeModeActive({ pendingStep: "awaiting_clarification", captionText: "" }), false);
});
