# SNAP EAT — Test Audit

Generated: 2026-07-19
Scope: full repository audit performed before any testing-infrastructure changes were made. This document reports what existed **at the start of this work**, verified by reading source files and executing the existing test suite.

---

## 1. Project Architecture

SNAP EAT is a nutrition-tracking product with three deployable pieces sharing one repository:

```
SnapEAT/
├── src/            React 19 + Vite frontend (mobile-first web app)
├── shared/         Plain JS/TS modules imported by BOTH frontend and backend
├── bot/            Node.js backend: Express API + WhatsApp bot + AI engine
│   ├── index.js          2,620-line entrypoint: Express server, Baileys WhatsApp
│   │                      socket, and nearly all conversational/routing logic
│   ├── services/          Factored business logic (meal analysis, memory,
│   │                      barcode/product lookup, nutrition knowledge/RAG)
│   ├── knowledge/         17 Hebrew markdown files = the RAG knowledge base source
│   ├── tests/             Existing Node-test-runner unit tests (10 files)
│   ├── scripts/           One-off script to build the OpenAI Vector Store
│   ├── firebase-admin.js  Firebase Admin SDK init (service account)
│   └── auth_info/         Baileys WhatsApp session credentials (gitignored)
├── docs/           (did not exist before this work)
└── dist/           Vite build output
```

There is no separate "backend" folder distinct from the bot — the Express REST API, the WhatsApp bot, and most of the AI engine all live inside `bot/`, sharing the same services. This is a monolith by design, not an oversight, and this audit treats "backend" and "bot" as the same deployable.

### Module system
- Root app: ES modules, TypeScript (`.tsx`/`.ts`), bundled by Vite.
- `bot/`: ES modules, plain JavaScript (no TypeScript, no build step — run directly by Node).
- `shared/`: plain `.js` with a hand-written `.d.ts` for the frontend's benefit; imported directly by both sides (`bot/index.js` imports `../shared/meal-analysis.js`; `src/utils/mealsApi.ts` imports `../../shared/meal-analysis.js`). No path aliasing — genuinely the same files on disk.

---

## 2. Backend / WhatsApp Bot / AI Engine (`bot/`)

These three are not cleanly separated in code, so they are audited together.

### 2.1 Express REST API (used by the React frontend)
Only 4 HTTP routes exist in the whole backend, all in `bot/index.js`:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/meals/analyze` | none | Upload a meal photo (multer), run OpenAI vision analysis, return structured `analysis` + `imageUrl` |
| POST | `/api/diary/meals` | none | Persist an analyzed meal to Firestore diary |
| PATCH | `/api/diary/meals/:mealId` | **Firebase ID token required** (`Authorization: Bearer <token>`, verified via `getAuth().verifyIdToken()` at `bot/index.js:1602`) | Edit an existing diary meal |
| GET | `/` | none | Liveness/health text response |

Static file serving also exists for `bot/uploads/meal-images` (meal photo URLs returned to the frontend).

**Note:** the two most-used write routes (`analyze`, and `diary/meals` POST) have **no authentication** — anyone who can reach the server can call them. This is an existing production behavior; this audit reports it as-is per instructions not to change production behavior, but it is called out under gaps/risks below.

### 2.2 WhatsApp Bot
`bot/index.js` boots a Baileys (`@whiskeysockets/baileys`) multi-device WhatsApp socket (`makeWASocket`), persists session credentials to `bot/auth_info/` (gitignored, contains live session secrets), and implements the entire conversational flow inline: incoming message classification, image vs. text vs. barcode routing, clarification loops, memory updates, and reply sending. There's no route/controller separation here — it's one large message-handler flow reading `process.env.ALLOWED_CHATS` as an allowlist.

### 2.3 AI Engine
Powered by the OpenAI SDK (`openai` npm package), used in several independent capacities:

- **Meal analysis** (`bot/services/meal-analysis.js`): vision model call to turn a photo into structured nutrition JSON, with a repair/merge path for incomplete model responses (`mergeMissingMealAnalysisFields`, `repairMealAnalysisFromClarification`) and normalization shared with the frontend (`shared/meal-analysis.js`).
- **Nutrition knowledge / RAG** (`bot/services/nutrition-knowledge.service.js`): OpenAI **Responses API** with hosted `file_search` against an **OpenAI Vector Store** (not a custom vector DB) built from `bot/knowledge/*.md`. Requires `OPENAI_VECTOR_STORE_ID` + `OPENAI_MODEL`; falls back to a safe Hebrew message if either is missing or the API call fails. Vector store is built by `bot/scripts/create-nutrition-knowledge-base.js` (`npm run knowledge:create`), not by application runtime code.
- **Routing** (`bot/services/nutrition-routing.helper.js`): deterministic (non-LLM) classifier deciding whether a message is a "general nutrition question" that should go to the RAG flow vs. the normal conversation flow.
- **Packaged-product image classification** (`bot/services/packaged-product-image.service.js`): OpenAI vision call classifying an image as `PACKAGED_PRODUCT` / `MEAL_OR_FOOD` / `UNKNOWN`, used to route to barcode lookup vs. meal analysis.
- **Barcode decoding** (`bot/services/barcode-image.service.js`): `zxing-wasm`-based decode, not an LLM call.
- **Product lookup** (`bot/services/food-product.service.js`): calls an external open food-facts-style API by barcode (confirmed via test: "the product lookup service never imports or depends on OpenAI") — deterministic, no LLM.
- **Memory** (`bot/services/memory.service.js` + `bot/services/memory-update/merge.helper.js`): long-term user memory (goals, allergies, likes/dislikes) stored in Firestore (`userMemories` collection), plus conversation history (`chatMessages`) and rolling conversation summaries (`conversationSummaries`, generated via `gpt-4o-mini` when `CONVERSATION_SUMMARY_THRESHOLD` messages accumulate). Patch merging has explicit safety logic — e.g. allergy removal only accepted above a confidence threshold (`MEMORY_SAFETY_REMOVAL_MIN_CONFIDENCE`).

### 2.4 Firebase Usage
- **Backend** (`bot/firebase-admin.js`): Firebase Admin SDK, credentials from `bot/firebase-service-account.json` (gitignored secret file). Used for Firestore (`db`) and Cloud Storage (`bucket`), plus `getAuth()` for ID-token verification on the one authenticated route.
- **Frontend** (`src/firebase.ts`): Firebase Web SDK (`firebase/app`, `firebase/firestore/lite`, `firebase/auth`), config hardcoded in source (this is normal for Firebase web apps — the API key is not a secret, access control is via Firestore security rules, not this key). Frontend talks to Firestore **directly** for favorites (`src/utils/favoritesApi.ts`) and reads/writes meals/journal data directly too (per `NutritionJournalScreen.tsx`), while meal analysis and diary-meal creation/editing go through the backend REST API. So Firestore access is **split**: some through backend (Admin SDK), some direct from the browser (client SDK + security rules).
- Auth: Firebase Auth, email/password (`LoginScreen.tsx`, `SignupScreen.tsx`) plus Google/Facebook OAuth popups (`src/utils/socialAuth.ts`).

### 2.5 Environment Variables (backend)
`PORT`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_VECTOR_STORE_ID`, `OPENAI_FILE_SEARCH_MAX_RESULTS`, `FIREBASE_STORAGE_BUCKET`, `ALLOWED_CHATS`, `PAIRING_PHONE`, `WA_BUTTON_PHONE`, `CONVERSATION_SUMMARY_THRESHOLD`, `MEMORY_RECENT_MESSAGES_LIMIT`, `MEMORY_UPDATE_MIN_CONFIDENCE`, `MEMORY_SAFETY_REMOVAL_MIN_CONFIDENCE`, `DEBUG_MEAL_ANALYSIS`. All read with safe fallbacks/defaults where observed.

---

## 3. Frontend (`src/`)

React 19 + `react-router` (v7) SPA, Tailwind v4, built with Vite. No frontend testing library, test runner, or config of any kind existed before this work (confirmed: no `vitest`/`jest`/`@testing-library/*` in `package.json` or `node_modules`, no `*.test.*`/`*.spec.*` files under `src/`).

### Routes / Screens (`src/App.tsx`)
`/splash`, `/welcome`, `/hello`, `/login`, `/signup`, `/details`, `/home` (journal), `/meal/:mealType` (category/upload), `/my-meals`, `/meal-analysis-result`, `/favorites`. `ProfileDrawer` is not a route — it's rendered as an overlay/drawer from within screens.

### Notable characteristics relevant to testability
- No dedicated error-screen components exist; error states are handled inline per-page (try/catch + local state), confirmed by grepping every page file for error handling — all handle errors locally rather than via a shared boundary/component.
- API calls are centralized in `src/utils/mealsApi.ts` (backend REST) and `src/utils/favoritesApi.ts` (direct Firestore) — good seams for mocking in tests.
- `src/utils/socialAuth.ts` wraps Google/Facebook popup sign-in.
- Largest files (`MealCategoryScreen.tsx` 1,219 lines, `NutritionJournalScreen.tsx` 958 lines) mix data-fetching, business logic (e.g. calorie/macro extraction via regex on legacy text), and presentation — will need light seams (extracted pure functions) to unit test without a full DOM render, but nothing that requires touching production code.

---

## 4. Existing Tests (before this work)

**Frontend: zero tests.** No test files, no framework, no scripts.

**Backend: 10 test files, 144 tests, all passing.** Run with Node's built-in test runner (`node --test`), no external test framework (no Jest/Vitest/Mocha in `bot/`).

| File | Tests | Covers |
|---|---:|---|
| `bot/tests/food-product.service.test.js` | 8 | Barcode product formatting, safe wording, error non-leakage, no-OpenAI-dependency guarantee, User-Agent header |
| `bot/tests/meal-analysis-normalizer.test.js` | 12 | `shared/meal-analysis.js` normalization: numeric coercion, legacy text, calorie/macro mismatch warnings, malformed/empty AI responses |
| `bot/tests/meal-edit-helpers.test.js` | 11 | `shared/meal-edit.js`: edit-form prefill, payload building, negative-value rejection, bearer-token auth rejection |
| `bot/tests/memory-merge.test.js` | 12 | `merge.helper.js`: goal/preference merging, contradiction handling, allergy-removal confidence gating, immutability of inputs |
| `bot/tests/nutrition-knowledge.service.test.js` | 17 | RAG flow: missing config fallback, OpenAI failure fallback, citation handling, file_search params, safety wording for weight-loss questions |
| `bot/tests/nutrition-routing.helper.test.js` | 4 | Deterministic router: question vs. greeting vs. thanks vs. statement |
| `bot/tests/packaged-product-image.service.test.js` | 6 | Image classifier: 3-way result guarantee, failure fallback, empty-image handling |
| `bot/tests/product-amount.helper.test.js` | 13 | Hebrew quantity-text parsing (grams, halves/quarters, ambiguous input) |
| `bot/tests/barcode-image-routing.helper.test.js` | (part of 144) | Barcode-vs-image mode routing |
| `bot/tests/barcode-image.service.test.js` | (part of 144) | Barcode decode service |

Execution: `cd bot && node --test tests/*.test.js` → **144/144 passing**, 0 failures, ~151ms. (The one `NUTRITION KNOWLEDGE SERVICE FAILED` line in output is expected `console.error` output from a test that intentionally exercises the OpenAI-failure fallback path — not a real failure.)

All existing backend tests are **unit tests** exercising pure functions and service modules directly (no `supertest`/HTTP-level testing, no test hits a real Firebase or real OpenAI endpoint — external calls are either avoided entirely or the module is exercised with missing/invalid config to trigger fallback paths).

**No integration tests** (nothing exercises the Express app's HTTP routes end-to-end). **No frontend tests. No AI evaluation harness/eval suite. No coverage tool** (no `c8`/`nyc`/`--experimental-test-coverage` wired into any script).

---

## 5. npm Scripts (before this work)

Root `package.json`:
```
dev, build, lint, preview
```
No `test` script at the root at all.

`bot/package.json`:
```
start                 → node index.js
test                  → node --test tests/*.test.js
knowledge:create       → node scripts/create-nutrition-knowledge-base.js
```

---

## 6. Testing Framework Summary

| Layer | Framework before this work |
|---|---|
| Backend unit tests | Node.js built-in `node:test` + `node:assert` |
| Backend integration tests | none |
| Frontend tests | none |
| AI evaluation | none |
| Coverage reporting | none |
| CI wiring | none found (no `.github/workflows`) |

---

## 7. Missing Coverage (identified gaps to address in later phases)

**Backend, existing services with partial or no dedicated tests:**
- `bot/services/nutrition-instructions.js` — no dedicated test file.
- `bot/index.js` route handlers themselves (`/api/meals/analyze`, `/api/diary/meals` POST/PATCH) — only tested indirectly via the helper functions they call; no test drives the actual Express route (status codes, multer upload handling, auth rejection at the HTTP layer).
- Authentication at the HTTP layer — `extractBearerToken` is unit-tested, but no test confirms the PATCH route actually returns 401 for a missing/invalid token via a real request, nor that `verifyIdToken` failure is handled.
- `bot/services/memory.service.js` — **no dedicated test file at all**. All current memory-related tests exercise `merge.helper.js` (pure patch-merging logic), not `memory.service.js`'s Firestore-facing functions (`saveMessage`, `getUserMemory`, `applyIntelligentMemoryUpdate`, `getLatestSummary`, `getUnsummarizedMessages`, `getRecentEligibleMessages`, `saveConversationSummary`), including their validation and error-handling/fallback branches.
- `bot/tests/nutrition-routing.helper.test.js` is thin (20 lines, 4 cases) relative to the router's role as the gate into the RAG flow.

**Integration tests:** none exist. Needed for the 4 REST routes with Firebase Admin and OpenAI mocked.

**Frontend:** no infrastructure at all. Needed for Login, Register (Signup), meal upload flow, Journal, Favorites, Profile (drawer), and error states.

**AI evaluation:** no structured, repeatable evaluation harness for meal analysis quality, barcode accuracy, RAG answer quality, memory-update correctness, conversation summaries, cross-platform (web + WhatsApp) consistency, or error-handling behavior under adversarial/malformed input. This audit found only ad-hoc unit tests of the deterministic wrapper logic around these AI calls, not evaluation of the AI behavior itself.

**Documentation:** no `docs/` directory existed at all before this work.

---

## 8. Constraints Carried Into Later Phases

- All new tests must mock Firebase (Admin + client SDK) and OpenAI — never call production services.
- No existing test, production file, or documented behavior is to be modified as part of adding coverage.
- Backend stays on Node's built-in `node:test` for consistency with the 144 existing tests (no framework migration).
- Frontend needs a testing library added from scratch — chosen in Phase 4 with justification.

---

## 9. Coverage Reporting

Added in a follow-up pass (2026-07-19) after the testing infrastructure above was in place. See `docs/testing/README.md` §"Coverage" for the command list and this section's numbers reproduced there.

### 9.1 Tooling choice

- **Backend**: Node's built-in `--experimental-test-coverage` (V8-based, ships with Node — no new runtime dependency). Reporting uses the built-in `spec` reporter (terminal table) and `lcov` reporter (`--test-reporter=lcov`) run together in one pass. HTML is generated from the lcov file by `@lcov-viewer/cli` (1 dependency of its own, ~123 kB unpacked) — the only backend devDependency added, because Node's coverage has no built-in HTML output and the system `genhtml`/`lcov` tools are not installed on this machine or guaranteed on others.
- **Frontend**: `@vitest/coverage-v8` — the official first-party Vitest coverage package, using the V8 provider (no source instrumentation step, lighter than the `istanbul` provider). Configured with `reporter: ["text", "html", "json", "lcov"]` in `vitest.config.js` so one run produces all three requested formats.

### 9.2 Exact commands

```bash
npm run coverage             # root: backend (unit+integration) then frontend
npm run coverage:backend     # root: bot's combined coverage script
npm run coverage:frontend    # root: vitest run --coverage

cd bot
npm run coverage             # unit + integration in one instrumented run + HTML
npm run coverage:unit        # unit tests only
npm run coverage:integration # integration tests only
```

Backend output: `bot/coverage/lcov.info`, `bot/coverage/html/index.html` (combined run); `bot/coverage/unit/lcov.info`, `bot/coverage/integration/lcov.info` (granular runs). Frontend output: `coverage/lcov.info`, `coverage/coverage-final.json`, `coverage/index.html`. All `coverage/` directories are gitignored.

### 9.3 Measured numbers (this run, not projected)

**Backend — unit tests only** (172 tests, `bot/tests/*.test.js`):

| File | Line | Branch | Funcs |
|---|---:|---:|---:|
| `services/barcode-image-routing.helper.js` | 100.00% | 100.00% | 100.00% |
| `services/barcode-image.service.js` | 76.92% | 80.00% | 50.00% |
| `services/food-product.service.js` | 96.13% | 69.01% | 88.89% |
| `services/memory-update/merge.helper.js` | 92.13% | 67.57% | 90.48% |
| `services/memory.service.js` | 91.96% | 71.15% | 84.21% |
| `services/nutrition-instructions.js` | 100.00% | 100.00% | 100.00% |
| `services/nutrition-knowledge.service.js` | 89.05% | 72.00% | 93.33% |
| `services/nutrition-routing.helper.js` | 100.00% | 75.00% | 75.00% |
| `services/packaged-product-image.service.js` | 54.29% | 75.00% | 33.33% |
| `services/product-amount.helper.js` | 85.94% | 91.67% | 100.00% |
| `shared/meal-analysis.js` | 90.32% | 79.90% | 90.91% |
| `shared/meal-edit.js` | 95.17% | 65.84% | 100.00% |
| **All files** | **90.69%** | **72.92%** | **88.27%** |

**Backend — integration tests only** (13 tests, `bot/integration/*.test.js`):

| File | Line | Branch | Funcs |
|---|---:|---:|---:|
| `integration/app.harness.js` | 95.48% | 56.10% | 100.00% |
| `services/meal-analysis.js` | 67.95% | 60.53% | 80.00% |
| `shared/meal-analysis.js` | 66.50% | 74.19% | 81.82% |
| `shared/meal-edit.js` | 59.66% | 47.62% | 60.00% |
| **All files** | **72.51%** | **61.28%** | **78.95%** |

**Backend — unit + integration combined** (185 tests, one instrumented run, real merged numbers — not an average of the two above):

| File | Line | Branch | Funcs |
|---|---:|---:|---:|
| **All files** | **90.47%** | **71.70%** | **90.48%** |

`services/meal-analysis.js` and `shared/*.js` are the only files exercised by both suites; everything else in the unit-only table is unchanged in the combined run since integration tests don't touch it (the harness only wires the 4 REST routes — barcode/RAG/memory services aren't reachable from HTTP in this codebase, see §2.2).

**Frontend** (`src/`, `all: true` — every included file counted, not just tested ones):

| File | Stmts | Branch | Funcs | Lines |
|---|---:|---:|---:|---:|
| `App.tsx` | 0% | 0% | 0% | 0% |
| `components/BottomNavbar.tsx` | 100% | 100% | 25% | 100% |
| `components/CameraCapture.tsx` | 89.57% | 79.16% | 71.42% | 89.57% |
| `pages/FavoriteMealsScreen.tsx` | 61.70% | 73.68% | 34.78% | 61.70% |
| `pages/HelloScreen.tsx` | 0% | 0% | 0% | 0% |
| `pages/LoginScreen.tsx` | 97.41% | 92.30% | 83.33% | 97.41% |
| `pages/MealAnalysisResultScreen.tsx` | 0% | 0% | 0% | 0% |
| `pages/MealCategoryScreen.tsx` | 0% | 0% | 0% | 0% |
| `pages/MyMealsScreen.tsx` | 0% | 0% | 0% | 0% |
| `pages/NutritionJournalScreen.tsx` | 84.54% | 66.01% | 65.71% | 84.54% |
| `pages/PersonalDetailsScreen.tsx` | 0% | 0% | 0% | 0% |
| `pages/ProfileDrawer.tsx` | 73.84% | 92.59% | 100% | 73.84% |
| `pages/SignupScreen.tsx` | 95.5% | 83.78% | 90% | 95.5% |
| `pages/SplashScreen.tsx` | 0% | 0% | 0% | 0% |
| `pages/WelcomeScreen.tsx` | 0% | 0% | 0% | 0% |
| `types/mealAnalysis.ts` | 0% | 0% | 0% | 0% |
| `utils/favoritesApi.ts` | 0% | 0% | 0% | 0% |
| `utils/mealsApi.ts` | 0% (branch 100%*) | — | — | 0% |
| `utils/socialAuth.ts` | 0% | 0% | 0% | 0% |
| `utils/whatsapp.ts` | 9.09% | 100% | 0% | 9.09% |
| **All files** | **38.97%** | **74.74%** | **55.88%** | **38.97%** |

`*` `utils/mealsApi.ts`'s functions are called only through mocks in tests (its real implementation never executes under test) — v8 still marks its few branch-free lines as trivially "covered" while statement/line coverage stays 0%; treat that row as effectively untested.

### 9.4 Uncovered high-risk areas (from these numbers, not opinion)

- `pages/MealCategoryScreen.tsx` (1,219 lines, 0%) — the largest untested file in the frontend; meal editing, favoriting, and category viewing all live here.
- `pages/MealAnalysisResultScreen.tsx` (0%) — where a freshly analyzed meal is reviewed/saved; directly downstream of the one hardware-dependent flow (`CameraCapture`) that *is* tested.
- `src/utils/favoritesApi.ts`, `src/utils/mealsApi.ts`, `src/utils/socialAuth.ts` (0% each) — every screen test mocks these at the module boundary, so their real implementations have zero executed lines anywhere in the suite; a bug inside these files specifically would not be caught by any current frontend test.
- `services/packaged-product-image.service.js` (54.29% line, 33.33% funcs) — lowest-covered backend service; its default (non-injected) OpenAI classifier path is not exercised by any current unit test (only the injectable-`classifyImpl` seam is).
- `services/barcode-image.service.js` (76.92% line, 50% funcs) — similar gap around its default decode path.
- Backend integration branch coverage (61.28%) is the lowest number in the whole report — expected, since integration tests target specific status-code paths per route rather than exhaustively branching through `shared/meal-edit.js`'s validation rules (that exhaustive branch coverage lives in the unit suite instead, at 65.84–79.90% for the same files).

### 9.5 Limitations

- **Coverage ≠ correctness ≠ safety.** A covered line only proves it executed during a test, not that the test asserted anything meaningful about it, and never that an AI-generated output was good or safe — that's what `evaluation/` is for. Do not treat these percentages as a substitute for `MANUAL_TEST_CHECKLIST.md` or `evaluation/reports/*.json`.
- **`bot/index.js` and `bot/firebase-admin.js` never appear in any backend coverage report** — not because they're excluded, but because no test imports them at all (see §2.2/§7 and `bot/integration/app.harness.js`'s header comment). Their real coverage is 0% by omission; that omission is itself documented, not hidden.
- Backend unit and integration coverage are reported both separately **and** combined (§9.3) — the combined number is the accurate one since Node instruments both suites in one process; the separate numbers exist only to show which suite is responsible for which lines.
- Frontend coverage uses `all: true`, so newly added untested files will show as 0% by default rather than being silently absent from the report — this is intentional (see `vitest.config.js` comment) and will make the aggregate percentage look lower than a "tested files only" view would.
- No coverage thresholds are enforced (no failing build below X%) — `npm test` and `npm run build` are unaffected by coverage numbers; `npm run coverage` is purely informational per this task's requirements.
