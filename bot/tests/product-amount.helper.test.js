import test from "node:test";
import assert from "node:assert/strict";

import { parseProductAmountInput } from "../services/product-amount.helper.js";

// 21. amount parser for grams
test("parses a plain grams amount", () => {
  assert.deepEqual(parseProductAmountInput("125 גרם"), { type: "grams", grams: 125 });
});

test("parses grams amount embedded in a sentence", () => {
  assert.deepEqual(parseProductAmountInput("אכלתי 200 גרם"), { type: "grams", grams: 200 });
});

test("parses a simple grams amount", () => {
  assert.deepEqual(parseProductAmountInput("100 גרם"), { type: "grams", grams: 100 });
});

// 22. amount parser for half package
test("parses 'חצי אריזה' as a half-package fraction", () => {
  assert.deepEqual(parseProductAmountInput("חצי אריזה"), { type: "package_fraction", fraction: 0.5 });
});

test("parses bare 'חצי' as a half-package fraction", () => {
  assert.deepEqual(parseProductAmountInput("חצי"), { type: "package_fraction", fraction: 0.5 });
});

// 23. amount parser for quarter package
test("parses 'רבע אריזה' as a quarter-package fraction", () => {
  assert.deepEqual(parseProductAmountInput("רבע אריזה"), { type: "package_fraction", fraction: 0.25 });
});

test("parses bare 'רבע' as a quarter-package fraction", () => {
  assert.deepEqual(parseProductAmountInput("רבע"), { type: "package_fraction", fraction: 0.25 });
});

// 24. amount parser for full package
test("parses 'אריזה שלמה' as a full package", () => {
  assert.deepEqual(parseProductAmountInput("אריזה שלמה"), { type: "package_fraction", fraction: 1 });
});

test("parses 'כל האריזה' as a full package", () => {
  assert.deepEqual(parseProductAmountInput("כל האריזה"), { type: "package_fraction", fraction: 1 });
});

test("parses a bare numeric fraction like 0.5 as a package fraction", () => {
  assert.deepEqual(parseProductAmountInput("0.5"), { type: "package_fraction", fraction: 0.5 });
});

// 25. ambiguous unit does not guess
test("does not guess grams for an unverified unit such as a tablespoon", () => {
  assert.deepEqual(parseProductAmountInput("כף אחת"), { type: "unsupported_unit" });
});

test("does not guess grams for 'מנה' (a portion)", () => {
  assert.deepEqual(parseProductAmountInput("מנה אחת"), { type: "unsupported_unit" });
});

test("returns ambiguous for unparseable free text", () => {
  assert.deepEqual(parseProductAmountInput("אולי קצת"), { type: "ambiguous" });
});

test("returns ambiguous for blank input", () => {
  assert.deepEqual(parseProductAmountInput("   "), { type: "ambiguous" });
});
