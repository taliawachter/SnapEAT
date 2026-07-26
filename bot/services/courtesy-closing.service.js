import { normalizeScopeText } from "./scope-guard.service.js";

const THANK_YOU_REPLY_HEBREW =
  "😊 בשמחה!\nאם יהיו לך עוד שאלות על תזונה, ארוחות או מוצרים – אני כאן.";

const CONVERSATION_ENDING_REPLY_HEBREW =
  "😊 בשמחה!\nשיהיה לך יום נפלא, ואם תצטרך עזרה נוספת בנושא תזונה ומעקב ארוחות – אני כאן.";

// Matching a term list against the whole message (exact match or substring)
// mirrors GREETING_TERMS in scope-guard.service.js, so e.g. "תודה רבה" and
// "מעולה תודה" are covered by the single term "תודה".
const THANK_YOU_TERMS = ["תודה", "תותח", "מעולה"];

// Note: "ערב טוב", "לילה טוב" and "שבת שלום" (via "שלום") also match
// scope-guard.service.js's GREETING_TERMS. The greeting check runs first in
// index.js (unchanged, per "preserve all existing behavior"), so those three
// phrases keep returning the greeting reply, not the closing reply below.
const CONVERSATION_ENDING_TERMS = [
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

function matchesTermList(normalizedText, terms) {
  return terms.some((term) => normalizedText === term || normalizedText.includes(term));
}

export function isThankYouMessage(text = "") {
  const normalizedText = normalizeScopeText(text);
  if (!normalizedText) return false;
  return matchesTermList(normalizedText, THANK_YOU_TERMS);
}

export function isConversationEndingMessage(text = "") {
  const normalizedText = normalizeScopeText(text);
  if (!normalizedText) return false;
  return matchesTermList(normalizedText, CONVERSATION_ENDING_TERMS);
}

export function getThankYouReply() {
  return THANK_YOU_REPLY_HEBREW;
}

export function getConversationEndingReply() {
  return CONVERSATION_ENDING_REPLY_HEBREW;
}

// Centralized entry point, mirroring getGreetingResponseForUser: a pending
// step always wins (never interrupts an active flow), it never calls
// OpenAI, and it is meant to run before the nutrition scope guard so a
// courtesy/closing message never reaches isNutritionRelatedMessage().
export function getCourtesyResponseForUser({ text, pendingState = null } = {}) {
  const pendingStep = typeof pendingState?.step === "string" ? pendingState.step.trim() : "";
  if (pendingStep) {
    return { shouldReply: false, reply: null };
  }

  if (isThankYouMessage(text)) {
    return { shouldReply: true, reply: getThankYouReply() };
  }

  if (isConversationEndingMessage(text)) {
    return { shouldReply: true, reply: getConversationEndingReply() };
  }

  return { shouldReply: false, reply: null };
}
