import { writeReport, printReport } from "./lib/evaluation-runner.js";
import { runSuite as mealAnalysisSuite } from "./templates/meal-analysis.eval.js";
import { runSuite as barcodeSuite } from "./templates/barcode.eval.js";
import { runSuite as ragSuite } from "./templates/rag.eval.js";
import { runSuite as memorySuite } from "./templates/memory.eval.js";
import { runSuite as conversationSummariesSuite } from "./templates/conversation-summaries.eval.js";
import { runSuite as crossPlatformSuite } from "./templates/cross-platform.eval.js";
import { runSuite as errorHandlingSuite } from "./templates/error-handling.eval.js";

const suites = [
  mealAnalysisSuite,
  barcodeSuite,
  ragSuite,
  memorySuite,
  conversationSummariesSuite,
  crossPlatformSuite,
  errorHandlingSuite,
];

async function main() {
  const reports = [];

  for (const runSuite of suites) {
    const report = await runSuite();
    printReport(report);
    const filePath = writeReport(report);
    reports.push({ ...report, filePath });
  }

  const totals = reports.reduce(
    (acc, r) => ({
      total: acc.total + r.summary.total,
      pass: acc.pass + r.summary.pass,
      warn: acc.warn + r.summary.warn,
      fail: acc.fail + r.summary.fail,
    }),
    { total: 0, pass: 0, warn: 0, fail: 0 }
  );

  console.log("\n=== Overall ===");
  console.log(
    `${totals.pass}/${totals.total} passed across ${reports.length} suites (${totals.warn} warned, ${totals.fail} failed).`
  );
  console.log("Reports written to evaluation/reports/*.json");

  if (totals.fail > 0) {
    process.exitCode = 1;
  }
}

await main();
