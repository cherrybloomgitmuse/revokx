import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readContainerVersion, runDirectusLab } from "../integrations/directus/run.js";
const expectedDirectory = resolve(fileURLToPath(new URL("../integrations/directus/", import.meta.url)));
test("version lookup selects the requested Compose files and project", () => {
  for (const [instance, prefix, expectedVersion] of [
    ["original", ["compose", "-f", "compose.yaml"], "11.4.0"],
    ["patched", ["compose", "-f", "compose.patched.yaml"], "11.5.1"],
    ["setup", [
      "compose", "-p", "revokx-directus-setup",
      "-f", "compose.patched.yaml",
      "-f", "compose.setup.yaml"
    ], "11.5.1"]
  ]) {
    const version = readContainerVersion(instance, (command, args, options) => {
      assert.equal(command, "docker");
      assert.deepEqual(args, [
        ...prefix,
        "exec", "-T", "directus", "node", "-p",
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
  for (const [instance, version] of [
    ["patched", "11.4.0"],
    ["setup", "11.4.0"],
    ["setup", "11.5.0"]
  ]) {
    const result = await runDirectusLab({}, {
      readVersion: async () => version,
      check: () => assert.fail("Experiment must not run"),
      save: () => assert.fail("Report must not be saved")
    }, { instance });
    assert.equal(result.error, "INSTANCE_VERSION_MISMATCH");
    assert.equal(result.exitCode, 2);
  }
});
test("patched and setup metadata do not force passing verdicts", async () => {
  for (const instance of ["patched", "setup"]) {
    for (const verdict of ["PASS", "FAIL"]) {
      const report = { verdict, cleanup: { restored: true } };
      let checked = false;
      let saved = false;
      const result = await runDirectusLab({}, {
        readVersion: async (selected) => {
          assert.equal(selected, instance);
          return "11.5.1";
        },
        check: async () => {
          checked = true;
          return report;
        },
        save: async (actual, options) => {
          assert.equal(actual, report);
          assert.deepEqual(options.application, {
            name: "directus",
            version: "11.5.1"
          });
          saved = true;
          return "test-report.json";
        }
      }, { instance });
      assert.equal(checked, true);
      assert.equal(saved, true);
      assert.equal(result.instance, instance);
      assert.equal(result.version, "11.5.1");
      assert.equal(result.exitCode, verdict === "PASS" ? 0 : 1);
    }
  }
});
test("unavailable setup instance cannot fall back to another project", async () => {
  const result = await runDirectusLab({}, {
    readVersion: async (instance) => {
      assert.equal(instance, "setup");
      throw new Error("Synthetic missing container");
    },
    check: () => assert.fail("Experiment must not run"),
    save: () => assert.fail("Report must not be saved")
  }, { instance: "setup" });
  assert.equal(result.exitCode, 2);
  assert.equal(result.error, "CONTAINER_VERSION_CHECK_FAILED");
});