import "dotenv/config";
import { db, bucket } from "./firebase-admin.js";
import fs from "fs";
import path from "path";
import express from "express";
import makeWASocket, {
  Browsers,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import OpenAI from "openai";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =====================
// Config
// =====================
const PORT = Number(process.env.PORT || 3000);

function normalizePhone(value = "") {
  let phone = String(value);

  if (phone.endsWith("@s.whatsapp.net")) {
    phone = phone.replace("@s.whatsapp.net", "");
  }

  phone = phone.replace(/\D/g, "");

  if (phone.startsWith("0")) {
    phone = "972" + phone.slice(1);
  }

  return phone;
}

const BOT_NUMBER = normalizePhone(process.env.PAIRING_PHONE || "");

const ALLOWED_NUMBERS = new Set(
  (process.env.ALLOWED_CHATS || "")
    .split(",")
    .map((s) => normalizePhone(s))
    .filter(Boolean)
);

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// =====================
// Storage
// =====================
const app = express();

const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

function normalizeMealType(text = "") {
  const t = text.trim().toLowerCase();

  if (t === "בוקר" || t === "ארוחת בוקר") return "breakfast";
  if (t === "צהריים" || t === "ארוחת צהריים") return "lunch";
  if (t === "ערב" || t === "ארוחת ערב") return "dinner";
  if (t === "ביניים" || t === "ארוחת ביניים") return "snack";

  return null;
}

async function uploadMealImage(buffer, mimeType, phone) {
  const normalizedPhone = normalizePhone(phone);
  const extension = mimeType?.includes("png") ? "png" : "jpg";
  const fileName = `meal-images/${normalizedPhone}/${Date.now()}.${extension}`;
  const file = bucket.file(fileName);

  await file.save(buffer, {
    metadata: {
      contentType: mimeType || "image/jpeg",
    },
    resumable: false,
  });

  await file.makePublic();

  return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
}

async function getUserByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);

  console.log("🔍 מחפש משתמש לפי phone:", normalizedPhone);

  const snapshot = await db
    .collection("users")
    .where("phone", "==", normalizedPhone)
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.log("❌ לא נמצא משתמש עם phone:", normalizedPhone);
    return null;
  }

  return {
    id: snapshot.docs[0].id,
    ...snapshot.docs[0].data(),
  };
}

async function saveMealEntry({
  from,
  mealNote = "",
  analysisText = "",
  imageUrl = null,
  mealType = "",
}) {
  const phone = normalizePhone(from);
  const user = await getUserByPhone(phone);

  if (!user) {
    console.log("❌ לא נמצא משתמש:", phone);
    return false;
  }

  const validMealTypes = ["breakfast", "lunch", "dinner", "snack"];
  if (!validMealTypes.includes(mealType)) {
    console.log("❌ סוג ארוחה לא חוקי:", mealType);
    return false;
  }

  const userRef = db.collection("users").doc(user.id);

  try {
    await userRef.collection("meals").add({
      mealNote,
      analysisText,
      imageUrl,
      mealType,
      createdAt: new Date(),
      source: "whatsapp",
      phone,
    });

    console.log("✅ ארוחה נשמרה עבור user:", user.id, "סוג:", mealType);
    return true;
  } catch (error) {
    console.log("❌ שגיאה בשמירת ארוחה:", error?.message || error);
    return false;
  }
}

async function getUserMeals(phone, limit = 5) {
  const user = await getUserByPhone(phone);

  if (!user) {
    console.log("❌ לא נמצא משתמש:", phone);
    return [];
  }

  const snapshot = await db
    .collection("users")
    .doc(user.id)
    .collection("meals")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

// =====================
// Express
// =====================
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.get("/", (req, res) => {
  const htmlPath = path.join(__dirname, "public", "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html.replaceAll(
    "__WA_PHONE__",
    process.env.WA_BUTTON_PHONE || "9725XXXXXXXX"
  );
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`✅ Web running: http://localhost:${PORT}`);
});

// =====================
// Memory
// =====================
const memory = new Map();
const pending = new Map();

function getHistory(chatId) {
  const h = memory.get(chatId) || [];
  return h.slice(-10);
}

function addToHistory(chatId, role, content) {
  const h = memory.get(chatId) || [];
  h.push({ role, content });
  memory.set(chatId, h.slice(-10));
}

// =====================
// Helpers
// =====================
function isGreeting(text) {
  const t = text.trim().toLowerCase();
  const greetings = [
    "היי",
    "הי",
    "שלום",
    "הלו",
    "אהלן",
    "מה קורה",
    "מה נשמע",
    "hi",
    "hello",
    "hey",
  ];
  return greetings.includes(t);
}

function shouldIgnoreMessage(msg, type) {
  if (type !== "notify") return true;
  if (!msg || !msg.message) return true;
  if (msg.key?.fromMe) return true;

  const from = msg.key?.remoteJid || "";
  if (!from) return true;

  if (from === "status@broadcast") return true;
  if (!from.endsWith("@s.whatsapp.net")) return true;

  const rawMessage = msg.message;
  const m =
    rawMessage?.ephemeralMessage?.message ||
    rawMessage?.viewOnceMessage?.message ||
    rawMessage;

  if (m?.protocolMessage) return true;
  if (msg.messageStubType) return true;

  if (
    rawMessage?.historySyncNotification ||
    m?.historySyncNotification ||
    rawMessage?.senderKeyDistributionMessage ||
    m?.senderKeyDistributionMessage
  ) {
    return true;
  }

  const hasImage = !!m?.imageMessage;
  const hasText = !!(
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption
  );

  if (!hasImage && !hasText) return true;

  return false;
}

function extractClarifyingQuestion(analysisText = "") {
  const match = analysisText.match(/שאלת הבהרה:\s*([\s\S]*)/);
  if (!match) return null;
  return match[1].trim().split("\n")[0].trim();
}

function sanitizeClarifyingQuestion(question = "") {
  const q = question.trim();

  const badPatterns = [
    "מה הכמות",
    "מהי הכמות",
    "כמות מדויקת",
    "הכמות המדויקת",
    "כמה גרם",
    "כמה מכל",
    "כמה מכל רכיב",
    "כמה מכל מרכיב",
    "כמה רכיבים",
    "מה הכמות המדויקת של כל",
    "מה הכמות של כל",
  ];

  const isBad = badPatterns.some((pattern) => q.includes(pattern));

  if (isBad || !q) {
    return "האם היה במנה רוטב, שמן, גבינה, שמנת או טיגון?";
  }

  return q;
}

function getFallbackClarifyingQuestion(analysisText = "") {
  const text = analysisText.toLowerCase();

  if (text.includes("סלט")) {
    return "האם היה רוטב, שמן או תוספות כמו קרוטונים וגבינה?";
  }

  if (text.includes("פסטה")) {
    return "האם היה רוטב שמנת, שמן, גבינה או חמאה?";
  }

  if (
    text.includes("טוסט") ||
    text.includes("כריך") ||
    text.includes("סנדוויץ")
  ) {
    return "האם היה רוטב, גבינה, חמאה או ממרח בתוך המנה?";
  }

  if (
    text.includes("שניצל") ||
    text.includes("צ'יפס") ||
    text.includes("מטוגן")
  ) {
    return "האם זה היה מטוגן בשמן והאם אכלת את כל המנה?";
  }

  if (text.includes("יוגורט") || text.includes("גרנולה")) {
    return "האם היה דבש, סוכר, גרנולה או תוספות נוספות?";
  }

  return "האם היה במנה רוטב, שמן, גבינה, שמנת או טיגון?";
}

function cleanAnalysisText(text = "") {
  return text
    .replace(/שאלת הבהרה:[\s\S]*/g, "")
    .replace(/זהו ניתוח ראשוני של ארוחה:/g, "")
    .replace(/זהו ניתוח ראשוני של תמונת אוכל:/g, "")
    .replace(/This is a preliminary analysis of a food image:/gi, "")
    .trim();
}

// =====================
// OpenAI helpers
// =====================
async function generateReply(chatId, userText) {
  if (isGreeting(userText)) {
    return "היי אהובה 😊 אני יכולה לעזור לך עם הערכת קלוריות, חלבון וניתוח ארוחות. תשלחי לי תמונת אוכל או שאלה על מה שאכלת.";
  }

  const phone = normalizePhone(chatId);
  const recentMeals = await getUserMeals(phone, 5);

  const mealsSummary = recentMeals.length
    ? recentMeals
        .map(
          (meal, i) =>
            `${i + 1}. תאריך: ${meal.createdAt}
סוג ארוחה: ${meal.mealType || "לא ידוע"}
הערת משתמש: ${meal.mealNote || "ללא הערה"}
ניתוח: ${meal.analysisText}`
        )
        .join("\n\n")
    : "אין היסטוריית ארוחות קודמת.";

  const messages = [
    {
      role: "system",
      content: `
את סוכנת תזונה חכמה, נעימה, מקצועית ותומכת.
עני תמיד בעברית טבעית, קצרה וברורה.

הנחיות:
- אם המשתמש/ת שואל/ת על אוכל, קלוריות, חלבון, דיאטה, שובע, נשנושים או ארוחות - תעני כמו עוזרת תזונה חכמה.
- אם זו הודעה כללית, עדיין תעני בטבעיות ובנעימות.
- תני תשובות פרקטיות וקצרות יחסית.
- אם חסר מידע, שאלי שאלה אחת קצרה.
- השתמשי בהיסטוריית הארוחות אם זה עוזר לתת תשובה אישית יותר.
- אל תתני ייעוץ רפואי.

היסטוריית ארוחות אחרונה:
${mealsSummary}
`.trim(),
    },
    ...getHistory(chatId),
    { role: "user", content: userText },
  ];

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.6,
  });

  return (
    resp.choices?.[0]?.message?.content?.trim() ||
    "תכתבי לי שוב ואנסה לעזור בצורה יותר מדויקת 🙏"
  );
}

async function estimateCaloriesFromImage(imageDataUrl, userNote = "") {
  const prompt = `
את תזונאית דיגיטלית חכמה שמנתחת תמונות אוכל.

המטרה שלך:
1. לזהות את האוכל
2. לפרט את רכיבי המנה
3. לתת לכל רכיב ערכים תזונתיים משוערים
4. להעריך סה"כ קלוריות ומאקרו
5. לשאול שאלה אחת קצרה שתשפר דיוק

חוקים חשובים מאוד:
- אסור לשאול על כמויות מדויקות של רכיבים.
- אסור לשאול שאלות שהמשתמש/ת כנראה לא יודע/ת לענות עליהן.
- מותר לשאול רק שאלות פשוטות ומעשיות, כמו:
  - האם היה רוטב?
  - האם היה שמן או חמאה?
  - האם זה מטוגן, אפוי או מבושל?
  - האם יש גבינה / שמנת / מיונז?
  - האם אכלת את כל המנה או רק חלק?
  - האם יש תוספת שלא רואים טוב בתמונה?
- השאלה חייבת להיות קצרה מאוד, טבעית וברורה.
- אם אין שאלה טובה במיוחד, שאלי:
  "האם היה במנה רוטב, שמן, גבינה או טיגון?"

החזירי בדיוק במבנה הזה:

זיהיתי:
[מה יש בתמונה]

רכיבים מפורטים:
[רכיב 1] | [קלוריות] | [חלבון] | [פחמימות] | [שומן] | [כמות/יחידות]
[רכיב 2] | [קלוריות] | [חלבון] | [פחמימות] | [שומן] | [כמות/יחידות]

קלוריות משוערות:
[טווח]
הערכה סבירה: [מספר אחד]

מאקרו משוער:
חלבון: [טווח]
פחמימות: [טווח]
שומן: [טווח]

💡 תובנות:
[2-3 משפטים קצרים על הארוחה]

שאלת הבהרה:
[שאלה אחת קצרה בלבד]

${userNote ? `הערת המשתמש: ${userNote}` : "אין הערת משתמש."}
`.trim();

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  });

  return (
    resp.choices?.[0]?.message?.content?.trim() ||
    "לא הצלחתי להעריך את הקלוריות מהתמונה. נסי לשלוח תמונה ברורה יותר 🙏"
  );
}

async function refineMealAnalysis(originalAnalysis, clarificationAnswer) {
  const prompt = `
זהו ניתוח ראשוני של תמונת אוכל:
${originalAnalysis}

המשתמש/ת הוסיף/ה הבהרה:
${clarificationAnswer}

עדכני את הערכת הקלוריות והמאקרו לפי ההבהרה.
כתבי בעברית טבעית, קצרה וברורה.
שמרי על אותו מבנה תשובה של הניתוח המקורי, כולל "רכיבים מפורטים" עם ערכים לכל רכיב,
אבל בלי "שאלת הבהרה" בסוף.
`.trim();

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  });

  return resp.choices?.[0]?.message?.content?.trim() || originalAnalysis;
}

// =====================
// WhatsApp Bot
// =====================
let sock = null;
let isStarting = false;
let reconnectTimer = null;

async function startBot() {
  if (isStarting) return;
  isStarting = true;

  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log("❌ חסר OPENAI_API_KEY בקובץ .env");
      return;
    }

    if (!process.env.FIREBASE_STORAGE_BUCKET) {
      console.log("❌ חסר FIREBASE_STORAGE_BUCKET בקובץ .env");
      return;
    }

    const authDir = path.join(__dirname, "auth_info");
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const pairingPhone = normalizePhone(process.env.PAIRING_PHONE || "");
    const usePairingCode =
      (process.env.USE_PAIRING_CODE || "false").toLowerCase() === "true";
    const shouldPair = !state.creds.registered;

    if (sock?.ws) {
      try {
        sock.ws.close();
      } catch {}
    }

    sock = makeWASocket({
      auth: state,
      version,
      browser: Browsers.macOS("Desktop"),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    sock.ev.on("creds.update", saveCreds);

    if (shouldPair && usePairingCode && !pairingPhone) {
      console.log("❌ חסר PAIRING_PHONE בקובץ .env");
      console.log("הוסיפי למשל: PAIRING_PHONE=9725XXXXXXXX");
    }

    if (shouldPair && !usePairingCode) {
      console.log("ℹ️ מצב QR פעיל.");
      console.log("סרקי את ה-QR דרך WhatsApp > Linked Devices");
    }

    let qrShown = false;
    let pairingRequested = false;

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      const reason = lastDisconnect?.error?.output?.statusCode;

      if (shouldPair && qr && !usePairingCode && !qrShown) {
        qrShown = true;
        console.log("📱 QR מוכן לסריקה:");
        qrcode.generate(qr, { small: true });
      }

      if (
        shouldPair &&
        connection === "connecting" &&
        usePairingCode &&
        pairingPhone &&
        !pairingRequested
      ) {
        pairingRequested = true;
        try {
          const code = await sock.requestPairingCode(pairingPhone);
          console.log("🔑 Pairing code:", code);
          console.log("פתחי וואטסאפ > Linked Devices > Link with phone number");
        } catch (err) {
          console.log("❌ שגיאה בקבלת pairing code:", err?.message || err);
          pairingRequested = false;
        }
      }

      if (connection === "open") {
        console.log("✅ מחובר ל-WhatsApp!");
        qrShown = false;
        pairingRequested = false;

        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      }

      if (connection === "close") {
        console.log("❌ החיבור נסגר. קוד:", reason);

        if (reason === DisconnectReason.loggedOut || reason === 401) {
          console.log("נדרש חיבור מחדש. מחקי auth_info ונסי שוב.");
          return;
        }

        if (reason === DisconnectReason.restartRequired || reason === 515) {
          console.log("🔄 restart required, מתחבר מחדש בעוד 2 שניות...");
          if (!reconnectTimer) {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              startBot();
            }, 2000);
          }
          return;
        }

        if (reason === 405) {
          console.log("405 בדרך כלל אומר בעיית pairing/session. מחקי auth_info ונסי שוב.");
          return;
        }

        console.log("החיבור נסגר. מנסה שוב בעוד 3 שניות...");
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            startBot();
          }, 3000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      const msg = messages?.[0];

      if (shouldIgnoreMessage(msg, type)) {
        console.log("⏭️ מדלג על הודעת sync/system/not-relevant");
        return;
      }

      const from = msg.key.remoteJid;
      const fromNumber = normalizePhone(from);

      if (fromNumber === BOT_NUMBER) {
        console.log("⛔ הודעה מהבוט עצמו - מדלג");
        return;
      }

      if (ALLOWED_NUMBERS.size && !ALLOWED_NUMBERS.has(fromNumber)) {
        console.log("⛔ נחסם - לא המספר המורשה:", fromNumber);
        return;
      }

      const rawMessage = msg.message;
      const m =
        rawMessage?.ephemeralMessage?.message ||
        rawMessage?.viewOnceMessage?.message ||
        rawMessage;

      const imageMessage = m?.imageMessage;
      const text =
        m?.conversation ||
        m?.extendedTextMessage?.text ||
        imageMessage?.caption ||
        "";

      console.log("📨 from:", fromNumber);
      console.log("📨 text:", text);

      try {
        if (imageMessage) {
          await sock.sendMessage(from, {
            text: "מנתחת את התמונה עכשיו, רגע 🙏",
          });

          const buffer = await downloadMediaMessage(
            msg,
            "buffer",
            {},
            { reuploadRequest: sock.updateMediaMessage }
          );

          const mime = imageMessage.mimetype || "image/jpeg";
          const base64 = buffer.toString("base64");
          const dataUrl = `data:${mime};base64,${base64}`;

          addToHistory(from, "user", text ? `[תמונה] ${text}` : "[תמונה]");

          const analysis = await estimateCaloriesFromImage(dataUrl, text);

          const extractedQuestion = extractClarifyingQuestion(analysis);
          const clarificationQuestion = sanitizeClarifyingQuestion(
            extractedQuestion || getFallbackClarifyingQuestion(analysis)
          );

          let uploadedImageUrl = null;

          try {
            uploadedImageUrl = await uploadMealImage(buffer, mime, fromNumber);
            console.log("✅ image uploaded:", uploadedImageUrl);
          } catch (uploadErr) {
            console.log(
              "❌ failed uploading image:",
              uploadErr?.message || uploadErr
            );
          }

          pending.set(from, {
            step: "awaiting_clarification",
            imageUrl: uploadedImageUrl,
            analysisText: analysis,
            mealNote: text || "",
            createdAt: Date.now(),
          });

          await sock.sendMessage(from, {
            text: `${cleanAnalysisText(analysis)}

כדי לדייק יותר:
${clarificationQuestion}`,
          });

          addToHistory(from, "assistant", cleanAnalysisText(analysis));
          return;
        }

        if (text.trim()) {
          const cleanText = text.trim();
          const p = pending.get(from);

          if (p?.step === "awaiting_clarification") {
            const refinedAnalysis = await refineMealAnalysis(
              p.analysisText,
              cleanText
            );

            pending.set(from, {
              ...p,
              step: "awaiting_meal_type",
              analysisText: cleanAnalysisText(refinedAnalysis),
              mealNote: p.mealNote,
            });

            await sock.sendMessage(from, {
              text: `${cleanAnalysisText(refinedAnalysis)}

איזו ארוחה זו הייתה?
כתבי רק אחת מהאפשרויות:
בוקר
צהריים
ערב
ביניים`,
            });

            return;
          }

          if (p?.step === "awaiting_meal_type") {
            const mealType = normalizeMealType(cleanText);

            if (!mealType) {
              await sock.sendMessage(from, {
                text: "לא הבנתי את סוג הארוחה.\nכתבי רק:\nבוקר\nצהריים\nערב\nביניים",
              });
              return;
            }

            const saved = await saveMealEntry({
              from,
              mealNote: p.mealNote,
              analysisText: cleanAnalysisText(p.analysisText),
              imageUrl: p.imageUrl,
              mealType,
            });

            pending.delete(from);

            await sock.sendMessage(from, {
              text: saved
                ? "✅ נשמר בהצלחה ליומן באתר"
                : "לא מצאתי משתמש באתר עם מספר הטלפון הזה. תוודאי שבאתר נשמר אותו מספר טלפון בדיוק.",
            });

            return;
          }

          addToHistory(from, "user", cleanText);

          const reply = await generateReply(from, cleanText);
          await sock.sendMessage(from, { text: reply });

          addToHistory(from, "assistant", reply);
          return;
        }

        console.log("unsupported message");
      } catch (err) {
        console.log("❌ Error in messages.upsert:", err?.message || err);

        try {
          await sock.sendMessage(from, {
            text: "הייתה לי תקלה קטנה, נסי שוב עוד רגע 🙏",
          });
        } catch (sendErr) {
          console.log(
            "❌ failed sending error message:",
            sendErr?.message || sendErr
          );
        }
      }
    });
  } catch (err) {
    console.log("❌ startBot error:", err?.message || err);
  } finally {
    isStarting = false;
  }
}

startBot();