import test from "node:test";
import assert from "node:assert/strict";
import { runDirectusLab } from "../integrations/directus/run.js";
test("Directus launcher records container version without assuming its verdict", async () => {
  let savedOptions;
  const report = {
    verdict: "FAIL",
    reason: "PROTECTED_CONTENT_AFTER_SUSPENSION",
    cleanup: { restored: true }
  };
  const result = await runDirectusLab({}, {
    readVersion: async () => "11.4.0",
    check: async (options) => {
      assert.equal(options.baseUrl, "http://127.0.0.1:8055");
      assert.equal(options.revocationWindowMs, 0);
      return report;
    },
    save: async (value, options) => {
      assert.deepEqual(value, report);
      savedOptions = options;
      return "synthetic-report.json";
    }
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.reportPath, "synthetic-report.json");
  assert.deepEqual(savedOptions.application, {
    name: "directus",
    version: "11.4.0"
  });
});
test("Directus launcher stops before checking when version verification fails", async () => {
  for (const readVersion of [
    async () => "99.0.0",
    async () => { throw new Error("Synthetic Docker failure"); }
  ]) {
    let checks = 0;
    let saves = 0;
    const result = await runDirectusLab({}, {
      readVersion,
      check: async () => { checks++; },
      save: async () => { saves++; }
    });
    assert.equal(result.exitCode, 2);
    assert.equal(checks, 0);
    assert.equal(saves, 0);
  }
});
test("Directus launcher maps outcomes to exit codes", async () => {
  for (const [verdict, restored, expectedCode] of [
    ["PASS", true, 0],
    ["FAIL", true, 1],
    ["INCONCLUSIVE", true, 2],
    ["PASS", false, 2]
  ]) {
    let checked = false;
    let saved = false;
    const result = await runDirectusLab({}, {
      readVersion: async (instance) => {
        assert.equal(instance, "patched");
        return "11.5.1";
      },
      check: async () => {
        checked = true;
        return { verdict, cleanup: { restored } };
      },
      save: async () => {
        saved = true;
        return "synthetic-report.json";
      }
    }, { instance: "patched" });
    assert.equal(checked, true);
    assert.equal(saved, true);
    assert.equal(result.report.verdict, verdict);
    assert.equal(result.exitCode, expectedCode);
  }
});
test("Directus launcher preserves findings when report saving fails", async () => {
  const result = await runDirectusLab({}, {
    readVersion: async () => "11.4.0",
    check: async () => ({
      verdict: "FAIL",
      cleanup: { restored: true }
    }),
    save: async () => { throw new Error("Synthetic filesystem failure"); }
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.error, "REPORT_SAVE_FAILED");
  assert.equal(result.report.verdict, "FAIL");
});