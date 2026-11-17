import test from "node:test";
import assert from "node:assert/strict";
import {
  readContainerVersion,
  runDirectusLab
} from "../integrations/directus/run.js";
test("setup-original version lookup selects its dedicated project", () => {
  const version = readContainerVersion("setup-original", (command, args) => {
    assert.equal(command, "docker");
    assert.deepEqual(args, [
      "compose", "-p", "revokx-directus-setup-original",
      "-f", "compose.yaml",
      "exec", "-T", "directus", "node", "-p",
      "require('/directus/package.json').version"
    ]);
    return "11.4.0\n";
  });
  assert.equal(version, "11.4.0");
});
test("setup-original rejects patched versions before running the experiment", async () => {
  const result = await runDirectusLab({}, {
    readVersion: async () => "11.5.1",
    check: () => assert.fail("Experiment must not run"),
    save: () => assert.fail("Report must not be saved")
  }, { instance: "setup-original" });
  assert.equal(result.error, "INSTANCE_VERSION_MISMATCH");
  assert.equal(result.exitCode, 2);
});
test("setup-original verdict comes from observations rather than version", async () => {
  for (const verdict of ["PASS", "FAIL"]) {
    const report = { verdict, cleanup: { restored: true } };
    let saved = false;
    const result = await runDirectusLab({}, {
      readVersion: async (instance) => {
        assert.equal(instance, "setup-original");
        return "11.4.0";
      },
      check: async () => report,
      save: async (actual, options) => {
        assert.equal(actual, report);
        assert.deepEqual(options.application, {
          name: "directus",
          version: "11.4.0"
        });
        saved = true;
        return "synthetic-report.json";
      }
    }, { instance: "setup-original" });
    assert.equal(saved, true);
    assert.equal(result.instance, "setup-original");
    assert.equal(result.exitCode, verdict === "FAIL" ? 1 : 0);
  }
});