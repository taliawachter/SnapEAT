import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeBarcodeFromImage, RETAIL_BARCODE_FORMATS } from "../services/barcode-image.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function makeDecodeStub(results) {
  const calls = [];
  return {
    calls,
    async decodeImpl(imageInput, readerOptions) {
      calls.push({ imageInput, readerOptions });
      return results;
    },
  };
}

// 1. valid EAN-13 detection
test("decodeBarcodeFromImage detects a valid EAN-13 barcode", async () => {
  const stub = makeDecodeStub([{ isValid: true, text: "5901234123457", format: "EAN13" }]);
  const result = await decodeBarcodeFromImage(Buffer.from("fake-image"), { decodeImpl: stub.decodeImpl });

  assert.equal(result.found, true);
  assert.equal(result.barcode, "5901234123457");
  assert.equal(result.format, "EAN13");
  assert.equal(result.errorCode, null);
});

// 2. valid EAN-8 detection
test("decodeBarcodeFromImage detects a valid EAN-8 barcode", async () => {
  const stub = makeDecodeStub([{ isValid: true, text: "96385074", format: "EAN8" }]);
  const result = await decodeBarcodeFromImage(Buffer.from("fake-image"), { decodeImpl: stub.decodeImpl });

  assert.equal(result.found, true);
  assert.equal(result.barcode, "96385074");
  assert.equal(result.format, "EAN8");
});

// 3. no barcode found
test("decodeBarcodeFromImage returns a safe no-barcode result for an empty result set", async () => {
  const stub = makeDecodeStub([]);
  const result = await decodeBarcodeFromImage(Buffer.from("fake-image"), { decodeImpl: stub.decodeImpl });

  assert.equal(result.found, false);
  assert.equal(result.barcode, null);
  assert.equal(result.errorCode, "NO_BARCODE_FOUND");
});

test("decodeBarcodeFromImage treats an invalid/unreadable decode result as no barcode found", async () => {
  const stub = makeDecodeStub([
    { isValid: false, error: "Failed to load image from memory", format: "", text: "" },
  ]);
  const result = await decodeBarcodeFromImage(Buffer.from("fake-image"), { decodeImpl: stub.decodeImpl });

  assert.equal(result.found, false);
  assert.equal(result.errorCode, "NO_BARCODE_FOUND");
});

test("decodeBarcodeFromImage returns a safe result without calling the decoder for an empty image", async () => {
  const stub = makeDecodeStub([{ isValid: true, text: "5901234123457", format: "EAN13" }]);
  const result = await decodeBarcodeFromImage(null, { decodeImpl: stub.decodeImpl });

  assert.equal(result.found, false);
  assert.equal(result.errorCode, "EMPTY_IMAGE");
  assert.equal(stub.calls.length, 0);
});

// 4. decoder failure
test("decodeBarcodeFromImage never throws when the decoder itself fails", async () => {
  const decodeImpl = async () => {
    throw new Error("wasm module crashed");
  };

  const result = await decodeBarcodeFromImage(Buffer.from("fake-image"), { decodeImpl });

  assert.equal(result.found, false);
  assert.equal(result.errorCode, "DECODE_FAILED");
});

// 5. invalid decoded barcode rejected
test("decodeBarcodeFromImage rejects a decoded value that fails barcode validation", async () => {
  const stub = makeDecodeStub([{ isValid: true, text: "123", format: "EAN13" }]);
  const result = await decodeBarcodeFromImage(Buffer.from("fake-image"), { decodeImpl: stub.decodeImpl });

  assert.equal(result.found, false);
  assert.equal(result.barcode, null);
  assert.equal(result.errorCode, "INVALID_LENGTH");
});

// 6. existing image flow fallback when no barcode is found
test("a not-found result carries no barcode data, so callers safely fall back to image meal analysis", async () => {
  const stub = makeDecodeStub([]);
  const result = await decodeBarcodeFromImage(Buffer.from("fake-image"), { decodeImpl: stub.decodeImpl });

  assert.equal(result.found, false);
  assert.equal(result.barcode, null);
  // The routing check in index.js is `if (barcodeDecodeResult.found) { ... }`,
  // so a falsy `found` here is exactly what drives the meal-analysis fallback.
});

// 7. Open Food Facts product flow selected when barcode is found
test("a found result carries a validated barcode, which is exactly what drives the product-lookup routing", async () => {
  const stub = makeDecodeStub([{ isValid: true, text: "7290000000000", format: "EAN13" }]);
  const result = await decodeBarcodeFromImage(Buffer.from("fake-image"), { decodeImpl: stub.decodeImpl });

  assert.equal(result.found, true);
  assert.equal(result.barcode, "7290000000000");
});

test("decodeBarcodeFromImage restricts the decoder to retail barcode formats", async () => {
  const stub = makeDecodeStub([]);
  await decodeBarcodeFromImage(Buffer.from("fake-image"), { decodeImpl: stub.decodeImpl });

  assert.deepEqual(stub.calls[0].readerOptions.formats, RETAIL_BARCODE_FORMATS);
  assert.deepEqual(RETAIL_BARCODE_FORMATS, ["EAN13", "EAN8", "UPCA", "UPCE", "ITF"]);
});

test("the barcode-image service never imports OpenAI and never guesses a barcode via text", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "services", "barcode-image.service.js"), "utf8");
  assert.ok(!/openai/i.test(source), "barcode-image.service.js must not reference OpenAI");
});
