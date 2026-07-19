# AI Evaluation Suite

Structured, repeatable evaluations of SNAP EAT's AI-touching behavior — distinct from the pass/fail unit and integration tests in `bot/tests/` and `bot/integration/`. Each case here scores a **PASS / WARN / FAIL** verdict plus a 0–1 score and notes, and every run writes a JSON report to `evaluation/reports/`.

## Run it

```
npm run evaluation
```

Runs entirely offline by default — no real OpenAI or Firebase calls. Every category is safe to run in CI.

## Categories

| Template | What it evaluates |
|---|---|
| `templates/meal-analysis.eval.js` | Meal-analysis normalization, clarification triggering, honest handling of empty/malformed model output |
| `templates/barcode.eval.js` | Hebrew quantity parsing, barcode/meal/packaged-product routing priority |
| `templates/rag.eval.js` | Nutrition-question routing, citation-grounding enforcement, required safety instructions |
| `templates/memory.eval.js` | Allergy-removal safety threshold (boundary cases), non-mutation of caller state |
| `templates/conversation-summaries.eval.js` | Summary storage contract (shape, length bound, non-empty, rejects blank summaries) |
| `templates/cross-platform.eval.js` | WhatsApp-authored meals vs. web-rendered meals stay numerically and textually consistent |
| `templates/error-handling.eval.js` | Network/API/classifier failures degrade safely and never leak secrets or stack traces |

## How a case works

Each case is `{ name, run, judge }`. `run()` calls the real, unmodified production function — using that function's own injectable seams (`fetchImpl`, `classifyImpl`, `openaiClient`, `env`) to simulate failures or model responses without touching a network. `judge(output)` returns `{ verdict, score, notes }`.

## Running a category against the real, live model

Every template's file header documents exactly which fixture to swap for a live call (e.g. a real `openaiClient`, or `bot/services/meal-analysis.js`'s `analyzeMealImage` against a real photo). This requires a real `OPENAI_API_KEY` and is intentionally opt-in — nothing in this suite calls a live model unless you make that change yourself.

## Adding a new case

Add an entry to a template's `cases` array, or add a new `*.eval.js` template following the existing shape and register it in `run-evaluations.js`.
