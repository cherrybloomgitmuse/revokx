import { performance } from "node:perf_hooks";
import { runDirectusLab } from "./run.js";
const expectations = new Map([
  ["setup-original", { version: "11.4.0", verdict: "FAIL" }],
  ["setup", { version: "11.5.1", verdict: "PASS" }]
]);
export async function repeatDirectusLab(
  credentials,
  { instance, repetitions = 5 } = {},
  dependencies = {}
) {
  const expectation = expectations.get(instance);
  if (
    !expectation ||
    !Number.isSafeInteger(repetitions) ||
    repetitions < 1
  ) {
    throw new Error("INVALID_REPEAT_CONFIGURATION");
  }
  const run = dependencies.run ?? runDirectusLab;
  const runs = [];
  let stopReason = null;
  for (let index = 0; index < repetitions; index++) {
    const startedAt = new Date().toISOString();
    const startedMs = performance.now();
    let result;
    try {
      result = await run(credentials, {}, { instance });
    } catch {
      runs.push({
        run: index + 1,
        startedAt,
        durationMs: performance.now() - startedMs,
        error: "RUNNER_EXCEPTION"
      });
      stopReason = "RUNNER_EXCEPTION";
      break;
    }
    const report = result?.report;
    runs.push({
      run: index + 1,
      startedAt,
      durationMs: performance.now() - startedMs,
      version: result?.version ?? null,
      exitCode: result?.exitCode ?? null,
      verdict: report?.verdict ?? null,
      baselineVerified: report?.baselineVerified === true,
      suspensionVerified: report?.suspensionVerified === true,
      cleanupRestored: report?.cleanup?.restored === true,
      reportPath: result?.reportPath ?? null
    });
    const validOutcome =
      (result?.exitCode === 0 && report?.verdict === "PASS") ||
      (result?.exitCode === 1 && report?.verdict === "FAIL");
    if (result?.instance !== instance || result?.version !== expectation.version) {
      stopReason = "INSTANCE_OR_VERSION_NOT_VERIFIED";
    } else if (report?.cleanup?.restored !== true) {
      stopReason = "CLEANUP_NOT_VERIFIED";
    } else if (
      !validOutcome ||
      report.baselineVerified !== true ||
      report.suspensionVerified !== true ||
      typeof result.reportPath !== "string" ||
      result.reportPath.length === 0
    ) {
      stopReason = "RUN_OR_REPORT_NOT_VERIFIED";
    }
    if (stopReason) break;
  }
  const counts = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0, other: 0 };
  for (const run of runs) {
    if (["PASS", "FAIL", "INCONCLUSIVE"].includes(run.verdict)) {
      counts[run.verdict]++;
    } else {
      counts.other++;
    }
  }
  return {
    status: stopReason ? "STOPPED" : "COMPLETED",
    instance,
    expectedVersion: expectation.version,
    expectedVerdict: expectation.verdict,
    requestedRuns: repetitions,
    attemptedRuns: runs.length,
    matchingVerdicts: runs.filter(
      (run) => run.verdict === expectation.verdict
    ).length,
    counts,
    stopReason,
    runs
  };
}