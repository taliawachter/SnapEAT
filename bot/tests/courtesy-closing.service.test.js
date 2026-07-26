import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isThankYouMessage,
  isConversationEndingMessage,
  getThankYouReply,
  getConversationEndingReply,
  getCourtesyResponseForUser,
} from "../services/courtesy-closing.service.js";
import { isGreetingMessage } from "../services/scope-guard.service.js";

const THANK_YOU_MESSAGES = [
  "תודה",
  "תודה רבה",
  "תודה ❤️",
  "מעולה תודה",
  "מושלם תודה",
  "אחלה תודה",
  "אלופה תודה",
  "תותח",
  "מעולה",
];

const CONVERSATION_ENDING_MESSAGES = [
  "ביי",
  "להתראות",
  "יום טוב",
  "ערב טוב",
  "לילה טוב",
  "שבת שלום",
  "סיימנו",
  "זה הכל",
  "אין לי עוד שאלות",
  "נתראה",
];

test("recognizes all specified thank-you messages", () => {
  for (const text of THANK_YOU_MESSAGES) {
    assert.equal(isThankYouMessage(text), true, text);
  }
});

test("recognizes all specified conversation-ending messages", () => {
  for (const text of CONVERSATION_ENDING_MESSAGES) {
    assert.equal(isConversationEndingMessage(text), true, text);
  }
});

test("does not classify ordinary nutrition questions as courtesy/closing", () => {
  for (const text of [
    "כמה חלבון יש בטונה?",
    "מה כדאי לאכול אחרי אימון?",
    "מה אני צריכה לאכול בשביל לרדת במשקל",
  ]) {
    assert.equal(isThankYouMessage(text), false, text);
    assert.equal(isConversationEndingMessage(text), false, text);
  }
});

test("getCourtesyResponseForUser returns the exact thank-you reply", () => {
  const result = getCourtesyResponseForUser({ text: "תודה רבה", pendingState: null });
  assert.equal(result.shouldReply, true);
  assert.equal(result.reply, getThankYouReply());
  assert.equal(
    result.reply,
    "😊 בשמחה!\nאם יהיו לך עוד שאלות על תזונה, ארוחות או מוצרים – אני כאן."
  );
});

test("getCourtesyResponseForUser returns the exact conversation-ending reply", () => {
  const result = getCourtesyResponseForUser({ text: "ביי", pendingState: null });
  assert.equal(result.shouldReply, true);
  assert.equal(result.reply, getConversationEndingReply());
  assert.equal(
    result.reply,
    "😊 בשמחה!\nשיהיה לך יום נפלא, ואם תצטרך עזרה נוספת בנושא תזונה ומעקב ארוחות – אני כאן."
  );
});

test("active pending flow is not interrupted (mirrors greeting handler behavior)", () => {
  for (const text of ["תודה", "ביי", "סיימנו"]) {
    const result = getCourtesyResponseForUser({
      text,
      pendingState: { step: "awaiting_confirmation" },
    });
    assert.equal(result.shouldReply, false, text);
    assert.equal(result.reply, null, text);
  }
});

test("neither list overlaps with the other", () => {
  for (const text of THANK_YOU_MESSAGES) {
    assert.equal(isConversationEndingMessage(text), false, text);
  }
  for (const text of CONVERSATION_ENDING_MESSAGES.filter(
    (t) => !["ערב טוב", "לילה טוב", "שבת שלום"].includes(t)
  )) {
    assert.equal(isThankYouMessage(text), false, text);
  }
});

test("documents the known greeting/closing overlap for ערב טוב-style phrases", () => {
  // "ערב טוב", "לילה טוב" and "שבת שלום" are recognized by BOTH this
  // handler and scope-guard.service.js's GREETING_TERMS. index.js runs the
  // greeting check first (unchanged, per "preserve all existing
  // behavior"), so these three phrases keep returning the greeting reply.
  // This test locks in that both classifiers still see them as intended,
  // and documents which one wins by call order in index.js.
  for (const text of ["ערב טוב", "לילה טוב", "שבת שלום"]) {
    assert.equal(isGreetingMessage(text), true, text);
    assert.equal(isConversationEndingMessage(text), true, text);
  }
});

test("index.js runs the courtesy/closing check before the nutrition scope guard", () => {
  const indexPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "index.js"
  );
  const source = fs.readFileSync(indexPath, "utf8");

  const greetingCheckOffset = source.indexOf("greetingResult.shouldReply");
  const courtesyCheckOffset = source.indexOf("courtesyResult.shouldReply");
  const scopeGuardCheckOffset = source.indexOf("isNutritionRelatedMessage(cleanText, pendingState)");

  assert.ok(greetingCheckOffset !== -1, "expected greeting check in index.js");
  assert.ok(courtesyCheckOffset !== -1, "expected courtesy check in index.js");
  assert.ok(scopeGuardCheckOffset !== -1, "expected scope guard check in index.js");

  assert.ok(
    greetingCheckOffset < courtesyCheckOffset,
    "courtesy check must run after the greeting check"
  );
  assert.ok(
    courtesyCheckOffset < scopeGuardCheckOffset,
    "courtesy check must run before the nutrition scope guard"
  );
});
