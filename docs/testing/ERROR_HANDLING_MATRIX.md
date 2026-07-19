# SNAP EAT — Error Handling Matrix

Every known failure mode in the system, the expected safe behavior, and where that behavior is proven. "Covered by" points to a specific automated test or evaluation case — if it says "manual only," there is no automated proof and `MANUAL_TEST_CHECKLIST.md` is the only safety net.

| # | Failure mode | Expected safe behavior | Covered by |
|---|---|---|---|
| 1 | OpenAI API unreachable/errors during meal-photo analysis | Return `AI analysis is not configured` (503) if no key; otherwise 500 with no error details leaked | `bot/integration/api.test.js` ("returns 503...", "returns 500 without leaking...") |
| 2 | `OPENAI_API_KEY` missing | `analyzeMealImage`/`repairMealAnalysisFromClarification` throw `AI_NOT_CONFIGURED`, mapped to safe response | `bot/integration/api.test.js`, `bot/services/meal-analysis.js` |
| 3 | Model returns malformed/non-JSON output for meal analysis | Falls back to unknown-estimate structure, never throws to caller | `bot/tests/meal-analysis-normalizer.test.js` (#9), `evaluation/templates/meal-analysis.eval.js` |
| 4 | Model returns negative or nonsensical calorie/macro values | Normalized to non-negative; contradictory calorie/macro totals produce a warning + correction, never silently wrong data shown as certain | `bot/tests/meal-analysis-normalizer.test.js` (#6, #7), `evaluation/templates/meal-analysis.eval.js` |
| 5 | RAG: `OPENAI_VECTOR_STORE_ID` / `OPENAI_MODEL` missing | Safe Hebrew fallback text, `usedFallback: true`, no live call attempted | `bot/tests/nutrition-knowledge.service.test.js`, `evaluation/templates/rag.eval.js` |
| 6 | RAG: OpenAI Responses API throws | Safe Hebrew fallback, no leaked error message/stack/secrets | `bot/tests/nutrition-knowledge.service.test.js`, `evaluation/templates/error-handling.eval.js` |
| 7 | RAG: model answers with no file_search citation | Answer suppressed, replaced with "verified info unavailable" wording — never shown as fact | `bot/tests/nutrition-knowledge.service.test.js`, `evaluation/templates/rag.eval.js` |
| 8 | RAG: user asks for an unsafe/extreme numeric claim (e.g. extreme weight-loss rate) | Safe wording without exact numbers, no personalized plan offered | `bot/tests/nutrition-knowledge.service.test.js`, `evaluation/templates/rag.eval.js` |
| 9 | Barcode lookup: network failure (Open Food Facts unreachable) | `{ found: false, errorCode: "PRODUCT_LOOKUP_FAILED" }`, never throws | `evaluation/templates/error-handling.eval.js` |
| 10 | Barcode lookup: malformed upstream JSON | Same safe `PRODUCT_LOOKUP_FAILED` result | `evaluation/templates/error-handling.eval.js` |
| 11 | Barcode lookup: upstream HTTP 5xx | `PRODUCT_LOOKUP_FAILED`, distinct from a genuine `PRODUCT_NOT_FOUND` (never tells the user "not found" for a server error) | `evaluation/templates/error-handling.eval.js` |
| 12 | Barcode/product nutrition math: invalid weight (NaN, negative, absurd) | `{ ok: false, errorCode: "INVALID_WEIGHT" }`, never throws | `evaluation/templates/error-handling.eval.js` |
| 13 | Packaged-product image classifier throws/times out | Falls back to `UNKNOWN` classification, routes to the existing meal-analysis flow instead of crashing | `bot/tests/packaged-product-image.service.test.js`, `evaluation/templates/error-handling.eval.js` |
| 14 | Memory: Firestore read/write fails (`saveMessage`, `getUserMemory`, `applyIntelligentMemoryUpdate`, summaries) | Error is logged with context and re-thrown to the caller (caller decides fallback) — never silently swallowed, never partial-writes | `bot/tests/memory.service.test.js` |
| 15 | Memory: allergy-removal patch below safety confidence threshold | Allergy stays recorded; removal is reported as blocked, not silently dropped | `bot/tests/memory-merge.test.js` (#8), `evaluation/templates/memory.eval.js` |
| 16 | Memory: allergy-removal patch confidence exactly at the threshold | Accepted (`>=` semantics) — flagged in the evaluation suite as a boundary worth re-confirming intentional | `evaluation/templates/memory.eval.js` |
| 17 | Conversation summary: empty/blank summary text | Rejected before any Firestore write (`summary is required`) | `bot/tests/memory.service.test.js`, `evaluation/templates/conversation-summaries.eval.js` |
| 18 | Diary API: missing required fields on `POST /api/diary/meals` | 400 with `{ error: "Missing required fields" }` | `bot/integration/api.test.js` |
| 19 | Diary API: invalid `mealType` | 400 with `{ error: "Invalid meal type" }` | `bot/integration/api.test.js` |
| 20 | Diary edit: missing/invalid bearer token on `PATCH /api/diary/meals/:mealId` | 401 `{ code: "UNAUTHORIZED" }` — never reveals whether the meal exists | `bot/integration/api.test.js`, `shared/meal-edit.js` unit tests |
| 21 | Diary edit: meal ID doesn't exist for the authenticated user | 404 `{ code: "MEAL_NOT_FOUND" }` | `bot/integration/api.test.js` |
| 22 | Diary edit: invalid draft (negative numbers, forbidden text like "לא זמין" in a numeric field) | 400 `{ code: "INVALID_MEAL_PAYLOAD" }` with per-field Hebrew error detail | `shared/meal-edit.js` unit tests, `bot/integration/api.test.js` |
| 23 | Frontend: Firebase login with wrong credentials | Generic Hebrew error, does not reveal which field was wrong for security | `src/pages/LoginScreen.test.tsx` |
| 24 | Frontend: Firebase signup with already-registered email | Specific Hebrew error on the email field | `src/pages/SignupScreen.test.tsx` |
| 25 | Frontend: camera permission denied / no camera / browser unsupported | Distinct Hebrew message per case, capture button disabled | `src/components/CameraCapture.test.tsx` |
| 26 | Frontend: meal-photo analysis request fails after capture | Hebrew failure message, camera modal stays open (user can retry), no crash | `src/components/CameraCapture.test.tsx` |
| 27 | Frontend: Firestore read fails for favorites (`permission-denied` or other) | Falls back to an empty list instead of crashing the screen | `src/pages/FavoriteMealsScreen.test.tsx` |
| 28 | Frontend: Firestore read fails for the nutrition journal (`permission-denied`) | Shows a dedicated Hebrew banner but keeps the rest of the app usable | `src/pages/NutritionJournalScreen.test.tsx` |
| 29 | Frontend: logout (`signOut`) itself throws | Still clears local storage, closes the drawer, and navigates away | `src/pages/ProfileDrawer.test.tsx` |
| 30 | Frontend: profile Firestore read fails with `permission-denied` | Falls back to prop/auth-derived name and email instead of an error state | `src/pages/ProfileDrawer.test.tsx` |
| 31 | Cross-platform: a meal record has only legacy WhatsApp text and no structured `mealName` field | **Known gap** — meal name does not currently survive the round-trip (see below) | `evaluation/templates/cross-platform.eval.js` (fails intentionally) |
| 32 | Real camera hardware failures on-device | — | Manual only, see `MANUAL_TEST_CHECKLIST.md` §1 |
| 33 | Google/Facebook OAuth popup failures | — | Manual only, see `MANUAL_TEST_CHECKLIST.md` §3 |
| 34 | WhatsApp session drops / reconnect | Bot retries connection after 5s (`bot/index.js`, `startBot()` retry loop) | Manual only — not imported by any automated test, see `MANUAL_TEST_CHECKLIST.md` §4 |

## Known gap surfaced by the evaluation suite (row 31)

`evaluation/templates/cross-platform.eval.js` found that `normalizeMealRecordForDisplay` (in `shared/meal-analysis.js`) cannot recover a meal's name from legacy WhatsApp text (`analysisText`) when the record has no top-level `mealName` field, because `normalizeMealAnalysis({})` already fills in the placeholder `"ארוחה לא מזוהה"` — which is truthy, so the `normalized.mealName || legacy.mealName` fallback never reaches the legacy-parsed name. In current practice this is narrow: every meal saved through the current save path (`buildStoredMealEntry`, both in `bot/index.js` and the web API route) always sets `mealName` as a top-level field alongside `analysisText`, so this only affects genuinely old/legacy documents that predate structured fields, or documents edited by hand. Left unfixed here per this task's "do not change production behavior" constraint — flagged for a maintainer decision.
