import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSetupVersion } from "../integrations/directus/setup.js";
const expectedDirectory = resolve(
  fileURLToPath(new URL("../integrations/directus/", import.meta.url))
);
test("setup version lookup selects the correct disposable project", () => {
  for (const [instance, prefix, expectedVersion] of [
    ["original", [
      "compose", "-p", "revokx-directus-setup-original",
      "-f", "compose.yaml"
    ], "11.4.0"],
    ["patched", [
      "compose", "-p", "revokx-directus-setup",
      "-f", "compose.patched.yaml",
      "-f", "compose.setup.yaml"
    ], "11.5.1"]
  ]) {
    const version = readSetupVersion(instance, (command, args, options) => {
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
test("setup version lookup rejects invalid selection and mismatched versions", () => {
  assert.throws(
    () => readSetupVersion("unknown", () => assert.fail("Docker must not run")),
    /INVALID_SETUP_INSTANCE/
  );
  for (const [instance, wrongVersion] of [
    ["original", "11.5.1"],
    ["patched", "11.4.0"],
    ["patched", "11.5.0"]
  ]) {
    assert.throws(
      () => readSetupVersion(instance, () => wrongVersion),
      /SETUP_INSTANCE_VERSION_MISMATCH/
    );
  }
});
test("missing setup container fails without trying another project", () => {
  let calls = 0;
  assert.throws(() => readSetupVersion("original", () => {
    calls++;
    throw new Error("Synthetic missing container");
  }), /Synthetic missing container/);
  assert.equal(calls, 1);
});