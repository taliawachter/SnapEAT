# SNAP EAT — Evidence Guide

How to capture and organize proof that a change is safe to ship, and how to investigate a bug report. Applies to release sign-off, PR review, and incident follow-up.

## What counts as evidence

| Evidence type | How to capture | Where it lives |
|---|---|---|
| Automated test results | `npm test` output (or the individual `test:unit` / `test:integration` / `test:frontend` runs) | Paste the summary line(s) — e.g. `172 pass / 0 fail` — into the PR description or release notes. Full logs are reproducible by anyone from `main`, so don't archive raw logs long-term. |
| AI evaluation results | `npm run evaluation` output + the generated `evaluation/reports/*.json` | These files are gitignored (regenerable) — if a report shows a regression (new FAIL, dropped score), paste the specific case's `notes` field into the PR, don't just say "eval failed." |
| Manual QA | `docs/testing/MANUAL_TEST_CHECKLIST.md`, filled in | Keep a dated copy (e.g. in the release ticket) with tester name, commit hash, and any unchecked items explained. |
| Screenshots / screen recordings | Real device or browser, for anything in `MANUAL_TEST_CHECKLIST.md` involving UI, camera, or OAuth popups | Attach to the PR or release ticket. Crop/blur any real user data, phone numbers, or tokens before attaching anywhere shared. |
| Bug repro | Smallest possible failing case | Prefer converting it into a new automated test case (see below) over a one-off screenshot — a screenshot proves the bug happened once, a test proves it can't happen again silently. |

## Before marking a PR ready for review

1. Run `npm test` locally. All three layers (`test:unit`, `test:integration`, `test:frontend`) must pass — `npm test` runs them in that order and stops at the first failure.
2. If you touched anything AI-adjacent (`bot/services/meal-analysis.js`, `nutrition-knowledge.service.js`, `memory-update/merge.helper.js`, `packaged-product-image.service.js`, `food-product.service.js`, or `shared/meal-analysis.js`), run `npm run evaluation` and compare against the previous report (or re-run on `main` for a baseline) — a new FAIL or a dropped score on an existing PASS needs an explanation in the PR, not a silent merge.
3. If you touched a screen listed in `MANUAL_TEST_CHECKLIST.md`, walk the relevant section on a real device/browser before merging — jsdom-based frontend tests mock `getUserMedia`/`signInWithPopup`/etc. and cannot catch real-browser regressions in those APIs.
4. If you touched `bot/index.js` route bodies, update `bot/integration/app.harness.js` to match (see its header comment) — otherwise the integration suite silently stops reflecting production routes.

## Investigating a bug report

1. **Reproduce as a test first.** Before debugging by hand, try to write the smallest failing case: a unit test if it's a pure-function bug, an integration test if it's route/auth wiring, a frontend test if it's a UI/Firebase-interaction bug, or an evaluation case if it's an AI-quality/safety issue. A red test is both your debugging tool and your regression-proof fix verification.
2. **Check the error handling matrix first** (`ERROR_HANDLING_MATRIX.md`) — the failure mode may already be a documented, intentional behavior (e.g. a specific fallback message) rather than a bug.
3. **Never reproduce against production Firebase or OpenAI** to debug — use the same mocking patterns already in `bot/tests/`, `bot/integration/`, or `evaluation/templates/` (injectable `fetchImpl`/`classifyImpl`/`openaiClient`, or `mock.module` for `../firebase-admin.js`).
4. **For a live-model quality issue** (wrong nutrition estimate, bad RAG answer wording), that's not a code bug reproducible with a fixture — log it via `MANUAL_TEST_CHECKLIST.md` §6 and consider whether it points to a knowledge-base (`bot/knowledge/*.md`) or prompt change rather than application logic.

## Retention

- Automated test/eval output: not retained beyond the CI run or local terminal — it's fully reproducible from source at any commit.
- Manual QA checklists and screenshots tied to a specific release: keep with that release's ticket/record per your team's normal release-tracking process (this repo does not define a retention policy itself).
