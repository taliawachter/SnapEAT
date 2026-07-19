# SNAP EAT — Manual Test Checklist

Things automated tests structurally cannot verify: real device hardware, real third-party auth popups, a real WhatsApp session, and real AI model output quality. Walk this before a release, or after any change touching the areas below. Check off each item; note the date and build/commit tested.

Tested by: __________ Date: __________ Commit: __________

## 1. Camera / meal photo upload (`CameraCapture`)

- [ ] On a real phone browser, opening the camera prompts for permission.
- [ ] Denying permission shows the Hebrew "access blocked" message and the capture button is disabled (not a blank/broken screen).
- [ ] On a device with no camera, the "no camera found" message appears.
- [ ] Captured photo preview looks correct (not mirrored/rotated incorrectly) before confirming.
- [ ] "צלם שוב" (retake) actually restarts the live camera feed.
- [ ] Confirming a real photo shows a loading state, then navigates to the analysis result screen with real, sensible nutrition values (not obviously wrong — e.g. not 3 calories for a full plate).
- [ ] Turning off WiFi/data mid-analysis shows the Hebrew failure message and does not crash the app.

## 2. Firebase Auth — email/password

- [ ] Sign up with a new email succeeds and lands on `/details`.
- [ ] Sign up with an already-registered email shows the Hebrew "already registered" message.
- [ ] Login with correct credentials lands on `/home`.
- [ ] Login with wrong password shows the Hebrew generic error (does not reveal whether the email exists).
- [ ] Password reset / account recovery flow, if surfaced anywhere in the UI, works end to end (confirm current status — flagged as previously removed per git history; re-verify it's still absent or re-added correctly).

## 3. Firebase Auth — Google / Facebook (`socialAuth.ts`)

These use `signInWithPopup`, which cannot be driven in jsdom — must be tested in a real browser.

- [ ] Google sign-in popup completes and creates/loads the user correctly.
- [ ] Facebook sign-in popup completes and creates/loads the user correctly.
- [ ] Closing the popup without completing sign-in returns the user to a sane state (no stuck spinner).
- [ ] Signing in with a Google/Facebook account that shares an email with an existing password account behaves sensibly (does not silently create a duplicate/orphaned account).

## 4. WhatsApp bot (`bot/index.js`, Baileys)

Cannot be exercised by any automated test — no test imports `bot/index.js` (see `docs/testing/README.md`).

- [ ] `npm start` in `bot/` boots and prints a pairing QR / pairing code without crashing.
- [ ] Scanning/pairing connects a real WhatsApp session.
- [ ] Sending a real meal photo via WhatsApp returns a nutrition analysis in a reasonable time.
- [ ] Sending a real barcode photo triggers the barcode flow and returns real product data (or a clear "not found" message) from Open Food Facts.
- [ ] Asking a general nutrition question (e.g. "מה חשוב לדעת על סיבים תזונתיים?") returns a grounded answer with no "אין לי כרגע מספיק מידע" for a topic clearly covered in `bot/knowledge/*.md`.
- [ ] Asking an out-of-scope / risky question (e.g. asking for an extreme weight-loss rate) returns the safe fallback wording, not a fabricated number.
- [ ] The bot recovers (reconnects) after the WhatsApp session drops — leave it running and kill network briefly.
- [ ] `ALLOWED_CHATS` allowlist (if configured) is actually respected — a non-allowed number gets no response.

## 5. Cross-platform consistency (real data, not fixtures)

- [ ] Log a meal via WhatsApp, then open the web journal for the same account/day — calories and macros match.
- [ ] Edit a meal in the web app, then check that a WhatsApp-side view of the same meal (if applicable) reflects the edit.
- [ ] Favorite a meal on web, confirm it's usable from the favorites screen with correct nutrition values.

## 6. AI output quality (subjective — needs a human judgment call)

The automated evaluation suite (`npm run evaluation`) scores structural/safety properties with fixtures. It does not judge whether a live model's actual wording is good. Periodically (e.g. before a release, or after changing a prompt/instruction):

- [ ] Run 5–10 real meal photos through analysis; sanity-check ingredient identification and portion estimates.
- [ ] Run 5–10 real barcode scans; confirm product name/brand/nutrition look correct.
- [ ] Ask 5–10 real nutrition questions from `bot/README.md`'s sample list; confirm answers are grounded, safe, and in the right language.
- [ ] Deliberately ask something out of scope (medical diagnosis, exact weight-loss rate, personalized meal plan); confirm the bot declines appropriately per `NUTRITION_SYSTEM_INSTRUCTIONS`.

## 7. Environments / config sanity

- [ ] `bot/.env` has all variables listed in `docs/testing/TEST_AUDIT.md` §2.5 set correctly for the target environment.
- [ ] `VITE_API_BASE_URL`, `VITE_WA_PHONE`, `VITE_DEBUG_MEAL_ANALYSIS` are correct for the target environment (see `src/utils/mealsApi.ts`, `src/utils/whatsapp.ts`).
- [ ] Firestore security rules (not part of this repo's automated test scope) still match what the frontend's direct Firestore access (`favoritesApi.ts`, journal reads) expects.
