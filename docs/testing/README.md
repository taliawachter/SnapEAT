# SNAP EAT — Testing Infrastructure

This is the hub for everything test-related in this repository. Start here.

## Layers

| Layer | Location | Framework | Command |
|---|---|---|---|
| Backend unit tests | `bot/tests/` | Node built-in `node:test` | `npm run test:unit` |
| Backend integration tests | `bot/integration/` | Node built-in `node:test` + real `http`/`fetch` | `npm run test:integration` |
| Frontend component tests | `src/**/*.test.tsx` | Vitest + React Testing Library + jsdom | `npm run test:frontend` |
| AI evaluation suite | `evaluation/` | Custom lightweight runner (see `evaluation/README.md`) | `npm run evaluation` |
| Everything | — | — | `npm test` |
| Coverage (all layers) | — | Node built-in `--experimental-test-coverage` (backend) + `@vitest/coverage-v8` (frontend) | `npm run coverage` |

## Quick start

```bash
npm install          # root frontend deps
cd bot && npm install # backend deps
cd ..
npm test              # runs backend unit + integration + frontend
npm run evaluation     # runs the AI evaluation suite separately
```

`npm test` does **not** run `npm run evaluation` — evaluations are quality/behavior scoring, not pass/fail correctness gates, and are meant to be reviewed by a human, not just used as a merge gate. Run them explicitly and read `evaluation/reports/*.json`.

## Coverage

```bash
npm run coverage            # backend (unit+integration combined) + frontend, one after another
npm run coverage:backend    # bot/: unit + integration in one instrumented run
npm run coverage:frontend   # src/: vitest --coverage

# finer-grained backend views, run from inside bot/
cd bot
npm run coverage:unit         # unit tests only
npm run coverage:integration  # integration tests only
```

Each backend command prints a terminal summary table, writes an lcov file (`bot/coverage/**/lcov.info`), and (for `npm run coverage`) an HTML report at `bot/coverage/html/index.html`. The frontend command prints a terminal summary and writes `coverage/index.html`, `coverage/lcov.info`, and `coverage/coverage-final.json`. All `coverage/` output directories are gitignored — regenerate them, don't commit them.

**Last measured** (see `TEST_AUDIT.md` §9 for the full per-file breakdown and what's excluded):

| Suite | Line/Stmt | Branch | Funcs |
|---|---:|---:|---:|
| Backend — unit only | 90.69% | 72.92% | 88.27% |
| Backend — integration only | 72.51% | 61.28% | 78.95% |
| Backend — unit + integration combined | 90.47% | 71.70% | 90.48% |
| Frontend (`src/`, `all: true`) | 38.97% | 74.74% | 55.88% |

**A coverage percentage is not a quality signal on its own** — it only says a line executed at least once, not that the behavior at that line was checked against a rubric or was safe. It does not replace the manual QA in `MANUAL_TEST_CHECKLIST.md` or the scored AI evaluation suite in `evaluation/` — a file can be 100% line-covered by tests that assert nothing meaningful, and the evaluation suite exists precisely because coverage cannot judge AI output quality or safety. Use coverage to find code nobody exercises at all (the frontend's 0% files below are the actionable signal); don't chase a number.

## What's safe to run anywhere

Every automated test and every evaluation case in this repository is safe to run with **no real Firebase project, no real OpenAI key, and no network access**. External services are always mocked or replaced via injectable seams (see `docs/testing/TEST_AUDIT.md` §"Constraints"). If you ever see a test reach out to a real network address, that's a bug — report it.

## Where to look next

- **[TEST_AUDIT.md](./TEST_AUDIT.md)** — what existed before this testing infrastructure was built, and the full architecture map (backend/bot/AI-engine/frontend/Firebase).
- **[TEST_PLAN.md](./TEST_PLAN.md)** — testing strategy: what's covered at which layer and why, and what's intentionally left to manual QA.
- **[MANUAL_TEST_CHECKLIST.md](./MANUAL_TEST_CHECKLIST.md)** — the things automated tests structurally cannot cover (a real camera, a real phone's WhatsApp app, real model output quality) — walk this before a release.
- **[ERROR_HANDLING_MATRIX.md](./ERROR_HANDLING_MATRIX.md)** — every known failure mode, the expected safe behavior, and which test/eval proves it.
- **[EVIDENCE_GUIDE.md](./EVIDENCE_GUIDE.md)** — how to capture and file evidence when signing off a release or investigating a bug report.
- **[../../evaluation/README.md](../../evaluation/README.md)** — AI evaluation suite details.

## Known structural limitation (read before adding backend integration tests)

`bot/index.js` combines the Express API, the WhatsApp (Baileys) bot, and most of the AI-engine glue in one 2,600+ line file that unconditionally starts a real WhatsApp connection and binds a real port at import time. It cannot be safely `import`-ed by a test process. `bot/integration/app.harness.js` is a hand-maintained mirror of just the four Express routes, built from the same real service/shared modules `index.js` imports. If you change a route in `index.js`, update the harness to match — see the comment at the top of that file. A future refactor extracting `createApp()` from `index.js` would remove this duplication; that's out of scope for this testing-infrastructure work and is listed as a recommended follow-up.
