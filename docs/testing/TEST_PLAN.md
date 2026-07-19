# SNAP EAT — Test Plan

## Goal

Give every change to SNAP EAT (backend, WhatsApp bot, AI engine, frontend) a fast, offline, deterministic safety net, while being honest about what automated tests structurally cannot verify (camera hardware, real WhatsApp delivery, real model output quality) — those are covered by `MANUAL_TEST_CHECKLIST.md` and the AI evaluation suite instead.

## Strategy by layer

### Backend unit tests (`bot/tests/`)
**What:** Pure functions and service modules in isolation — validation, normalization, routing helpers, memory-merge logic, RAG safety fallbacks.
**Why here and not elsewhere:** These are the highest-leverage tests in the repo — cheap, fast (whole suite runs in ~200ms), and they pin down the exact safety behaviors that matter most (never show negative calories, never leak a raw error, never accept a low-confidence allergy removal).
**Mocking:** External calls are avoided entirely by using each function's injectable seam (`fetchImpl`, `classifyImpl`, `openaiClient`, `env`) or by mocking the one module boundary that touches Firebase (`../firebase-admin.js`) via `node:test`'s `mock.module`.

### Backend integration tests (`bot/integration/`)
**What:** The 4 Express routes end-to-end over real HTTP (`fetch` against a real `http.createServer`), through multer file upload, auth-token verification, and Firestore read/write — all with Firebase Admin, `firebase-admin/auth`, and the OpenAI client mocked.
**Why:** Unit tests prove the pieces work; integration tests prove they're *wired together* correctly — status codes, auth rejection, request/response shape.
**Known gap:** runs against `bot/integration/app.harness.js`, a maintained mirror of `bot/index.js`'s routes rather than `index.js` itself — see README for why.

### Frontend component tests (`src/**/*.test.tsx`)
**What:** Login, Signup, meal-photo upload (`CameraCapture`), the nutrition journal, favorites, and the profile drawer — rendered with React Testing Library against jsdom, with Firebase (`firebase/auth`, `firebase/firestore/lite`) and the backend API (`src/utils/*Api.ts`) mocked per test file.
**Why these six:** they cover every Firebase-auth entry point, the one flow that touches device hardware (camera) and the backend API, and the two screens with the richest Firestore read/write and error-recovery logic.
**Error-state coverage:** SNAP EAT has no dedicated error-screen components — every screen handles its own errors inline (confirmed in `TEST_AUDIT.md`). Error-state testing is therefore distributed across each screen's own test file rather than centralized: wrong password, email-already-registered, camera permission denied, analysis failure, Firestore permission-denied, and a failed logout are each tested where they actually occur in the code.

### AI evaluation suite (`evaluation/`)
**What:** Scored (not just pass/fail) evaluation of AI-adjacent behavior: meal analysis quality signals, barcode/quantity parsing accuracy, RAG groundedness and safety-instruction adherence, memory-safety boundaries, conversation-summary structural contract, web/WhatsApp cross-platform consistency, and an error-handling matrix.
**Why separate from tests:** a unit test asks "is this function correct." An evaluation asks "is this AI-touching behavior good, safe, and consistent" — which is a spectrum (PASS/WARN/FAIL + score), not a boolean. Keeping them separate means `npm test` stays a fast, strict merge gate, while `npm run evaluation` is a report to read.

## Priorities (what gets the most test weight)

1. **Safety-critical logic**: allergy-removal confidence threshold, "never invent nutrition facts/medical advice" instructions, never-leak-secrets error handling.
2. **Data correctness**: meal-analysis normalization, calorie/macro math, cross-platform consistency between WhatsApp and web.
3. **Auth boundaries**: the one authenticated route (`PATCH /api/diary/meals/:mealId`), Firebase Auth flows in the frontend.
4. **Fallback/degradation behavior**: every OpenAI- or Firestore-touching function has a documented safe-fallback path; each one is tested with its dependency simulated as failing.
5. **UI happy paths**: enough to catch obvious regressions, not exhaustive pixel/visual coverage (out of scope — no visual regression tooling is set up).

## Explicitly out of scope for automated tests

- Real camera hardware behavior (jsdom cannot drive a real `getUserMedia`/canvas pipeline meaningfully beyond mocked seams — see `MANUAL_TEST_CHECKLIST.md`).
- Real WhatsApp message delivery via Baileys (requires a live WhatsApp session; `bot/index.js`'s bot-startup code is not imported by any automated test — see README's "known structural limitation").
- Real OpenAI output quality/wording (the evaluation suite scores structural/safety properties using fixtures by default; live-model evaluation is opt-in and documented per template).
- Visual regression / cross-browser rendering.
- Load/performance testing.

## Adding tests for new work

- New backend service function → add a `bot/tests/<name>.test.js` file; use injectable seams before reaching for `mock.module`.
- New/changed Express route → update `bot/integration/app.harness.js` to match `bot/index.js`, then add/adjust a case in `bot/integration/api.test.js`.
- New frontend screen with Firebase/API calls → colocate `<Screen>.test.tsx`, mock `../firebase.js` and the specific `firebase/*` named exports you use (see any existing `src/pages/*.test.tsx` for the pattern).
- New AI-touching behavior → add a case to the relevant `evaluation/templates/*.eval.js`, or a new template if it's a new category.
