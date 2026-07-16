import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeBarcode } from "./food-product.service.js";

// Retail/packaged-food formats only. Never used for QR/matrix codes.
export const RETAIL_BARCODE_FORMATS = ["EAN13", "EAN8", "UPCA", "UPCE", "ITF"];

let localWasmPrepared = false;

// zxing-wasm defaults to fetching its .wasm binary from a jsDelivr CDN.
// The binary already ships inside the installed package, so we load it
// from disk once (via wasmBinary override) and never touch the network.
function prepareLocalWasmBinaryOnce(prepareZXingModule) {
  if (localWasmPrepared) return;
  localWasmPrepared = true;

  try {
    const wasmUrl = import.meta.resolve("zxing-wasm/reader/zxing_reader.wasm");
    const wasmBinary = fs.readFileSync(fileURLToPath(wasmUrl));
    prepareZXingModule({ overrides: { wasmBinary } });
  } catch {
    // If the local binary can't be located, zxing-wasm falls back to its
    // default (CDN) locateFile behavior rather than failing outright.
  }
}

async function defaultDecodeImpl(imageInput, readerOptions) {
  const { prepareZXingModule, readBarcodes } = await import("zxing-wasm/reader");
  prepareLocalWasmBinaryOnce(prepareZXingModule);
  return readBarcodes(imageInput, readerOptions);
}

/**
 * Attempts to decode a retail barcode (EAN-13/EAN-8/UPC-A/UPC-E/ITF) from an
 * image buffer. Never throws for a normal decoding failure — every path
 * returns a structured { found, barcode, format, errorCode } result. Never
 * logs image contents. The decoded text is always re-validated through
 * normalizeBarcode before being reported as found.
 */
export async function decodeBarcodeFromImage(
  imageInput,
  { decodeImpl = defaultDecodeImpl, formats = RETAIL_BARCODE_FORMATS } = {}
) {
  if (!imageInput) {
    return { found: false, barcode: null, format: null, errorCode: "EMPTY_IMAGE" };
  }

  let rawResults;
  try {
    rawResults = await decodeImpl(imageInput, { formats, maxNumberOfSymbols: 1 });
  } catch {
    return { found: false, barcode: null, format: null, errorCode: "DECODE_FAILED" };
  }

  const candidates = Array.isArray(rawResults) ? rawResults : [];
  const validCandidate = candidates.find((candidate) => candidate?.isValid && candidate?.text);

  if (!validCandidate) {
    return { found: false, barcode: null, format: null, errorCode: "NO_BARCODE_FOUND" };
  }

  const normalized = normalizeBarcode(validCandidate.text);
  if (!normalized.ok) {
    return {
      found: false,
      barcode: null,
      format: validCandidate.format || null,
      errorCode: normalized.errorCode,
    };
  }

  return {
    found: true,
    barcode: normalized.barcode,
    format: validCandidate.format || null,
    errorCode: null,
  };
}
