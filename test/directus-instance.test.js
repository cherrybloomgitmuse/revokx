import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readContainerVersion, runDirectusLab } from "../integrations/directus/run.js";
const expectedDirectory = resolve(fileURLToPath(new URL("../integrations/directus/", import.meta.url)));
test("version lookup selects the requested Compose file", () => {
  for (const [instance, file, expectedVersion] of [
    ["original", "compose.yaml", "11.4.0"],
    ["patched", "compose.patched.yaml", "11.5.1"]
  ]) {
    const version = readContainerVersion(instance, (command, args, options) => {
      assert.equal(command, "docker");
      assert.deepEqual(args, [
        "compose", "-f", file, "exec", "-T",
        "directus", "node", "-p",
        "require('/directus/package.json').version"
      ]);
      assert.equal(resolve(options.cwd), expectedDirectory);
      return `${expectedVersion}\n`;
    });
    assert.equal(version, expectedVersion);
  }
});
test("invalid instance is rejected before Docker or application requests", async () => {
  const unexpected = () => assert.fail("No operation should run");
  const result = await runDirectusLab({}, {
    readVersion: unexpected,
    check: unexpected,
    save: unexpected
  }, { instance: "unknown" });
  assert.equal(result.error, "INVALID_INSTANCE");
  assert.equal(result.exitCode, 2);
});
test("instance version mismatch stops before changing application state", async () => {
  const result = await runDirectusLab({}, {
    readVersion: async () => "11.4.0",
    check: () => assert.fail("Experiment must not run"),
    save: () => assert.fail("Report must not be saved")
  }, { instance: "patched" });
  assert.equal(result.error, "INSTANCE_VERSION_MISMATCH");
  assert.equal(result.exitCode, 2);
});
test("patched version metadata does not force a passing verdict", async () => {
  for (const verdict of ["PASS", "FAIL"]) {
    const report = { verdict, cleanup: { restored: true } };
    let saved = false;
    const result = await runDirectusLab({}, {
      readVersion: async (instance) => {
        assert.equal(instance, "patched");
        return "11.5.1";
      },
      check: async () => report,
      save: async (actual, options) => {
        assert.equal(actual, report);
        assert.deepEqual(options.application, {
          name: "directus",
          version: "11.5.1"
        });
        saved = true;
        return "test-report.json";
      }
    }, { instance: "patched" });
    assert.equal(saved, true);
    assert.equal(result.version, "11.5.1");
    assert.equal(result.exitCode, verdict === "PASS" ? 0 : 1);
  }
});