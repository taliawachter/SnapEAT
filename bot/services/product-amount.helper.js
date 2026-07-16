// Deterministic parsing only — no language model involved. If the amount
// can't be resolved to grams or a package fraction with confidence, callers
// must ask a follow-up question rather than guess.

const FULL_PACKAGE_PATTERNS = [/אריזה שלמה/, /כל האריזה/, /כל החבילה/, /^אריזה$/];
const HALF_PACKAGE_PATTERNS = [/חצי אריזה/, /^חצי$/];
const QUARTER_PACKAGE_PATTERNS = [/רבע אריזה/, /^רבע$/];

const UNSUPPORTED_UNIT_WORDS = ["כף", "כפית", "מנה", "חופן", "כוס", "פרוסה", "יחידה"];

function normalize(text = "") {
  return String(text || "").trim();
}

export function parseProductAmountInput(rawText) {
  const text = normalize(rawText);
  if (!text) return { type: "ambiguous" };

  const normalizedForGrams = text.replace(",", ".");
  const gramsMatch = normalizedForGrams.match(/(\d+(?:\.\d+)?)\s*(?:גרם|גר['׳]?|grams?|gr)(?![a-zA-Z])/i);
  if (gramsMatch) {
    const grams = Number(gramsMatch[1]);
    if (Number.isFinite(grams) && grams > 0) {
      return { type: "grams", grams };
    }
  }

  if (FULL_PACKAGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { type: "package_fraction", fraction: 1 };
  }
  if (HALF_PACKAGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { type: "package_fraction", fraction: 0.5 };
  }
  if (QUARTER_PACKAGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { type: "package_fraction", fraction: 0.25 };
  }

  const bareDecimalMatch = text.match(/^(0?\.\d+|1(?:\.0+)?)$/);
  if (bareDecimalMatch) {
    const fraction = Number(bareDecimalMatch[1]);
    if (fraction > 0 && fraction <= 1) {
      return { type: "package_fraction", fraction };
    }
  }

  const simpleFractionMatch = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (simpleFractionMatch) {
    const numerator = Number(simpleFractionMatch[1]);
    const denominator = Number(simpleFractionMatch[2]);
    if (denominator > 0) {
      const fraction = numerator / denominator;
      if (fraction > 0 && fraction <= 1) {
        return { type: "package_fraction", fraction };
      }
    }
  }

  const lower = text.toLowerCase();
  if (UNSUPPORTED_UNIT_WORDS.some((word) => lower.includes(word))) {
    return { type: "unsupported_unit" };
  }

  return { type: "ambiguous" };
}
