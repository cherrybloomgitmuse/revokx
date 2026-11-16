import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { checkDirectusRevocation } from "./check.js";
import { saveReport } from "../../src/report.js";
const integrationDirectory = fileURLToPath(new URL("./", import.meta.url));
const reportsDirectory = fileURLToPath(new URL("../../reports/directus/", import.meta.url));
const instances = new Map([
  ["original", { composeFile: "compose.yaml", versions: ["11.4.0"] }],
  ["patched", { composeFile: "compose.patched.yaml", versions: ["11.5.0", "11.5.1"] }]
]);
export function readContainerVersion(instance = "original", execute = execFileSync) {
  const configuration = instances.get(instance);
  if (!configuration) {
    throw new Error("INVALID_INSTANCE");
  }
  return execute("docker", [
    "compose", "-f", configuration.composeFile,
    "exec", "-T", "directus", "node", "-p",
    "require('/directus/package.json').version"
  ], {
    cwd: integrationDirectory,
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }).trim();
}
export async function runDirectusLab(credentials, dependencies = {}, options = {}) {
  const instance = options.instance ?? "original";
  const configuration = instances.get(instance);
  if (!configuration) {
    return { exitCode: 2, error: "INVALID_INSTANCE" };
  }
  const readVersion = dependencies.readVersion ?? readContainerVersion;
  const check = dependencies.check ?? checkDirectusRevocation;
  const save = dependencies.save ?? saveReport;
  let version;
  try {
    version = await readVersion(instance);
    if (!["11.4.0", "11.5.0", "11.5.1"].includes(version)) {
      return { exitCode: 2, error: "UNSUPPORTED_CONTAINER_VERSION" };
    }
    if (!configuration.versions.includes(version)) {
      return { exitCode: 2, error: "INSTANCE_VERSION_MISMATCH", instance, version };
    }
  } catch {
    return { exitCode: 2, error: "CONTAINER_VERSION_CHECK_FAILED" };
  }
  let report;
  try {
    report = await check({
      credentials,
      baseUrl: "http://127.0.0.1:8055",
      revocationWindowMs: 0,
      observationMs: 2000,
      pollIntervalMs: 100,
      requestTimeoutMs: 3000
    });
  } catch {
    return { exitCode: 2, error: "EXPERIMENT_EXECUTION_FAILED" };
  }
  try {
    const reportPath = await save(report, {
      application: { name: "directus", version },
      directory: reportsDirectory
    });
    const exitCode = report.verdict === "FAIL"
      ? 1
      : report.verdict === "PASS" && report.cleanup?.restored === true
        ? 0
        : 2;
    return { exitCode, instance, version, reportPath, report };
  } catch {
    return { exitCode: 2, error: "REPORT_SAVE_FAILED", report };
  }
}
const isMain = process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const credentials = {
    admin: {
      email: "admin@example.com",
      password: process.env.REVOKX_ADMIN_PASSWORD
    },
    target: {
      email: "target@example.com",
      password: process.env.REVOKX_TARGET_PASSWORD
    },
    control: {
      email: "control@example.com",
      password: process.env.REVOKX_CONTROL_PASSWORD
    }
  };
  delete process.env.REVOKX_ADMIN_PASSWORD;
  delete process.env.REVOKX_TARGET_PASSWORD;
  delete process.env.REVOKX_CONTROL_PASSWORD;
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !instances.has(args[0])) {
      console.error("Usage: node integrations/directus/run.js original|patched");
      process.exitCode = 2;
    } else {
      const result = await runDirectusLab(credentials, {}, { instance: args[0] });
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.exitCode;
    }
  } catch {
    console.error("DIRECTUS_LAUNCHER_FAILED");
    process.exitCode = 2;
  } finally {
    for (const credential of Object.values(credentials)) {
      credential.password = undefined;
    }
  }
}