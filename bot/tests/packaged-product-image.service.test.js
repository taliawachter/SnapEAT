import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyPackagedProductImage, CLASSIFICATION_VALUES } from "../services/packaged-product-image.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("classifies a branded packaged product image as PACKAGED_PRODUCT", async () => {
  const classifyImpl = async () => "PACKAGED_PRODUCT";
  const result = await classifyPackagedProductImage(Buffer.from("fake-image"), { classifyImpl });

  assert.equal(result.classification, "PACKAGED_PRODUCT");
  assert.equal(result.errorCode, null);
});

test("classifies a plated meal image as MEAL_OR_FOOD", async () => {
  const classifyImpl = async () => "MEAL_OR_FOOD";
  const result = await classifyPackagedProductImage(Buffer.from("fake-image"), { classifyImpl });

  assert.equal(result.classification, "MEAL_OR_FOOD");
});

test("falls back to UNKNOWN for an unrecognized classifier value instead of guessing", async () => {
  const classifyImpl = async () => "SOMETHING_ELSE";
  const result = await classifyPackagedProductImage(Buffer.from("fake-image"), { classifyImpl });

  assert.equal(result.classification, "UNKNOWN");
});

test("never throws when the classifier itself fails, falls back to UNKNOWN", async () => {
  const classifyImpl = async () => {
    throw new Error("vision call failed");
  };

  const result = await classifyPackagedProductImage(Buffer.from("fake-image"), { classifyImpl });

  assert.equal(result.classification, "UNKNOWN");
  assert.equal(result.errorCode, "CLASSIFICATION_FAILED");
});

test("returns a safe UNKNOWN result without calling the classifier for an empty image", async () => {
  let called = false;
  const classifyImpl = async () => {
    called = true;
    return "PACKAGED_PRODUCT";
  };

  const result = await classifyPackagedProductImage(null, { classifyImpl });

  assert.equal(result.classification, "UNKNOWN");
  assert.equal(result.errorCode, "EMPTY_IMAGE");
  assert.equal(called, false);
});

test("only ever returns one of the three defined classification values", () => {
  assert.deepEqual(CLASSIFICATION_VALUES, ["PACKAGED_PRODUCT", "MEAL_OR_FOOD", "UNKNOWN"]);
});

test("the classifier service never invents a barcode, product name, or nutrition value in its own source", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "services", "packaged-product-image.service.js"),
    "utf8"
  );
  assert.ok(!/openfoodfacts/i.test(source), "must not call Open Food Facts directly");
  assert.ok(!/normalizeBarcode|getProductByBarcode/.test(source), "must not touch barcode lookup logic");
});
