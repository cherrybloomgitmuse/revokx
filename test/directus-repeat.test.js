import test from "node:test";
import assert from "node:assert/strict";
import { repeatDirectusLab } from "../integrations/directus/repeat.js";
function result(instance, verdict, index) {
  return {
    instance,
    version: instance === "setup-original" ? "11.4.0" : "11.5.1",
    exitCode: verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 2,
    reportPath: `synthetic-report-${index}.json`,
    report: {
      verdict,
      baselineVerified: true,
      suspensionVerified: true,
      cleanup: { restored: true }
    }
  };
}
test("repeated experiments run sequentially and retain individual report paths", async () => {
  let active = 0;
  let calls = 0;
  const summary = await repeatDirectusLab({}, {
    instance: "setup-original",
    repetitions: 5
  }, {
    run: async (_credentials, _dependencies, options) => {
      active++;
      assert.equal(active, 1);
      const index = ++calls;
      await Promise.resolve();
      active--;
      return result(options.instance, "FAIL", index);
    }
  });
  assert.equal(summary.status, "COMPLETED");
  assert.equal(summary.matchingVerdicts, 5);
  assert.equal(summary.counts.FAIL, 5);
  assert.equal(new Set(summary.runs.map((run) => run.reportPath)).size, 5);
});
test("unexpected valid verdicts are recorded rather than rewritten", async () => {
  let calls = 0;
  const summary = await repeatDirectusLab({}, {
    instance: "setup",
    repetitions: 3
  }, {
    run: async () => result("setup", ++calls === 2 ? "FAIL" : "PASS", calls)
  });
  assert.equal(summary.status, "COMPLETED");
  assert.equal(summary.matchingVerdicts, 2);
  assert.equal(summary.counts.PASS, 2);
  assert.equal(summary.counts.FAIL, 1);
});
test("cleanup failure, inconclusive results, and missing reports stop further runs", async () => {
  for (const change of [
    (value) => { value.report.cleanup.restored = false; },
    (value) => {
      value.report.verdict = "INCONCLUSIVE";
      value.exitCode = 2;
    },
    (value) => { delete value.reportPath; },
    (value) => { value.version = "11.4.0"; }
  ]) {
    let calls = 0;
    const summary = await repeatDirectusLab({}, {
      instance: "setup",
      repetitions: 5
    }, {
      run: async () => {
        calls++;
        const value = result("setup", "PASS", calls);
        change(value);
        return value;
      }
    });
    assert.equal(summary.status, "STOPPED");
    assert.equal(calls, 1);
    assert.equal(summary.attemptedRuns, 1);
  }
});
test("runner exceptions stop repetition without exposing exception contents", async () => {
  const summary = await repeatDirectusLab({}, {
    instance: "setup"
  }, {
    run: async () => { throw new Error("synthetic-secret"); }
  });
  assert.equal(summary.status, "STOPPED");
  assert.equal(summary.stopReason, "RUNNER_EXCEPTION");
  assert.equal(JSON.stringify(summary).includes("synthetic-secret"), false);
});
test("invalid repeat configuration is rejected before any run", async () => {
  for (const options of [
    { instance: "unknown" },
    { instance: "setup", repetitions: 0 },
    { instance: "setup", repetitions: 1.5 }
  ]) {
    await assert.rejects(
      repeatDirectusLab({}, options, {
        run: () => assert.fail("Experiment must not run")
      }),
      /INVALID_REPEAT_CONFIGURATION/
    );
  }
});