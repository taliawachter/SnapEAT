import { isGreetingMessage as isGreetingMessageFromScopeGuard } from "./scope-guard.service.js";

export const FULL_WELCOME_GREETING_REPLY = "היי! 😊\nאני SNAP EAT, העוזרת שלך לכל מה שקשור למזון, תזונה ומעקב ארוחות.\n\nאפשר לשאול אותי על:\n🥗 ניתוח ארוחות\n🍎 קלוריות וערכים תזונתיים\n💪 חלבון, פחמימות ושומן\n📦 מוצרים וברקודים\n📖 מתכונים\n❤️ הארוחות השמורות שלך";

export const SHORT_GREETING_REPLY = "היי! איך אפשר לעזור לך היום? 😊";

function normalizePhone(value = "") {
  let phone = String(value || "");

  if (phone.endsWith("@s.whatsapp.net")) {
    phone = phone.replace("@s.whatsapp.net", "");
  }

  phone = phone.replace(/\D/g, "");

  if (phone.startsWith("0")) {
    phone = "972" + phone.slice(1);
  }

  return phone;
}

export async function getGreetingResponseForUser({
  phone,
  text,
  pendingState = null,
  storage,
}) {
  const pendingStep = typeof pendingState?.step === "string" ? pendingState.step.trim() : "";
  if (pendingStep) {
    return { shouldReply: false, reply: null };
  }

  if (!isGreetingMessageFromScopeGuard(text)) {
    return { shouldReply: false, reply: null };
  }

  if (!storage) {
    return { shouldReply: true, reply: SHORT_GREETING_REPLY };
  }

  const normalizedPhone = normalizePhone(phone);

  try {
    const welcomeFlag = await storage.readWelcomeFlag(normalizedPhone);
    if (welcomeFlag) {
      return { shouldReply: true, reply: SHORT_GREETING_REPLY };
    }

    await storage.saveWelcomeFlag(normalizedPhone, true);
    return { shouldReply: true, reply: FULL_WELCOME_GREETING_REPLY };
  } catch {
    console.log("⚠️ Greeting welcome flag unavailable");
    return { shouldReply: true, reply: SHORT_GREETING_REPLY };
  }
}
