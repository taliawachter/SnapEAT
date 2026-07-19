import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(__dirname, "..", "reports");

/**
 * Runs one evaluation suite: a named category ("Meal Analysis", "RAG", ...)
 * made of individual cases. Each case runs a "subject" (the real production
 * code under evaluation, or a fixture standing in for a live model call) and
 * scores the result against a rubric. Unlike a pass/fail unit test, a case
 * may PASS, FAIL, or WARN, and always records a 0-1 score plus notes — this
 * is what makes the output suitable for tracking AI-behavior quality over
 * time, not just correctness of deterministic code.
 *
 * @param {string} suiteName
 * @param {Array<{
 *   name: string,
 *   mode?: "fixture" | "live",
 *   run: () => Promise<any> | any,
 *   judge: (output: any) => { verdict: "PASS"|"FAIL"|"WARN", score: number, notes: string },
 * }>} cases
 */
export async function runEvaluationSuite(suiteName, cases) {
  const results = [];

  for (const testCase of cases) {
    const startedAt = Date.now();
    let output;
    let error = null;

    try {
      output = await testCase.run();
    } catch (err) {
      error = err;
    }

    const durationMs = Date.now() - startedAt;

    let verdict = "FAIL";
    let score = 0;
    let notes = "";

    if (error) {
      notes = `Threw instead of returning a result: ${error?.message || error}`;
    } else {
      try {
        const judged = testCase.judge(output);
        verdict = judged.verdict;
        score = judged.score;
        notes = judged.notes;
      } catch (judgeError) {
        notes = `Judge itself threw: ${judgeError?.message || judgeError}`;
      }
    }

    results.push({
      name: testCase.name,
      mode: testCase.mode || "fixture",
      verdict,
      score,
      notes,
      durationMs,
    });
  }

  const summary = summarize(results);

  return {
    suite: suiteName,
    generatedAt: new Date().toISOString(),
    summary,
    cases: results,
  };
}

function summarize(results) {
  const total = results.length;
  const pass = results.filter((r) => r.verdict === "PASS").length;
  const warn = results.filter((r) => r.verdict === "WARN").length;
  const fail = results.filter((r) => r.verdict === "FAIL").length;
  const averageScore = total
    ? Math.round((results.reduce((sum, r) => sum + (r.score || 0), 0) / total) * 100) / 100
    : 0;

  return { total, pass, warn, fail, averageScore };
}

export function writeReport(report) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const safeName = report.suite.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const filePath = path.join(REPORTS_DIR, `${safeName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  return filePath;
}

export function printReport(report) {
  const { suite, summary } = report;
  console.log(`\n=== ${suite} ===`);
  for (const c of report.cases) {
    const icon = c.verdict === "PASS" ? "✔" : c.verdict === "WARN" ? "⚠" : "✖";
    console.log(`  ${icon} [${c.mode}] ${c.name} (score ${c.score}) — ${c.notes}`);
  }
  console.log(
    `  -> ${summary.pass}/${summary.total} passed, ${summary.warn} warned, ${summary.fail} failed, avg score ${summary.averageScore}`
  );
}
