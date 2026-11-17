import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createDirectusClient } from "./client.js";
import { ensureDocumentFixture } from "./ensure-document.js";
import { ensureLabUsers } from "./ensure-users.js";
import { fixtureDocument } from "./inspect-document.js";
import { classifyDocumentResponse } from "./classify.js";
const integrationDirectory = fileURLToPath(new URL("./", import.meta.url));
const setupInstances = new Map([
  ["original", {
    project: "revokx-directus-setup-original",
    composeFiles: ["compose.yaml"],
    version: "11.4.0"
  }],
  ["patched", {
    project: "revokx-directus-setup",
    composeFiles: ["compose.patched.yaml", "compose.setup.yaml"],
    version: "11.5.1"
  }]
]);
function validCredentials(credentials) {
  return ["admin", "target", "control"].every((name) =>
    credentials?.[name]?.email === `${name}@example.com` &&
    typeof credentials[name].password === "string" &&
    credentials[name].password.length > 0
  ) && credentials.target.password !== credentials.control.password;
}
export async function setupDirectusLab(credentials, dependencies = {}) {
  if (!validCredentials(credentials)) {
    return {
      status: "INCONCLUSIVE",
      reason: "INVALID_SETUP_CREDENTIALS",
      accessVerified: false
    };
  }
  const results = {};
  let stage = "admin-login";
  try {
    const client = dependencies.client ?? createDirectusClient({
      baseUrl: "http://127.0.0.1:8055",
      requestTimeoutMs: 15000
    });
    const ensureDocument = dependencies.ensureDocument ?? ensureDocumentFixture;
    const ensureUsers = dependencies.ensureUsers ?? ensureLabUsers;
    const admin = await client.login(credentials.admin);
    stage = "admin-identity";
    const identity = await admin.readIdentity();
    if (
      identity.status !== 200 ||
      identity.body?.data?.email !== "admin@example.com" ||
      identity.body?.data?.status !== "active"
    ) {
      throw new Error("ADMIN_IDENTITY_NOT_VERIFIED");
    }
    stage = "document-setup";
    results.document = await ensureDocument(admin);
    if (results.document.status !== "MATCH") {
      return {
        status: results.document.status,
        reason: "DOCUMENT_SETUP_NOT_VERIFIED",
        results,
        accessVerified: false
      };
    }
    stage = "user-setup";
    results.users = await ensureUsers(admin, credentials);
    if (results.users.status !== "MATCH") {
      return {
        status: results.users.status,
        reason: "USER_SETUP_NOT_VERIFIED",
        results,
        accessVerified: false
      };
    }
    const access = {};
    for (const name of ["target", "control"]) {
      stage = `${name}-login`;
      const session = await client.login(credentials[name]);
      stage = `${name}-document`;
      access[name] = classifyDocumentResponse(
        await session.readDocument(1),
        fixtureDocument
      );
    }
    stage = "anonymous-document";
    access.anonymous = classifyDocumentResponse(
      await client.readAnonymousDocument(1),
      fixtureDocument
    );
    const accessVerified = access.target === "allowed" &&
      access.control === "allowed" &&
      access.anonymous === "denied";
    return {
      status: accessVerified ? "MATCH" : "INCONCLUSIVE",
      reason: accessVerified
        ? "LAB_SETUP_AND_BASELINE_VERIFIED"
        : "BASELINE_ACCESS_NOT_VERIFIED",
      results,
      access,
      accessVerified
    };
  } catch {
    return {
      status: "INCONCLUSIVE",
      reason: "LAB_SETUP_FAILED",
      stage,
      results,
      accessVerified: false
    };
  }
}
export function readSetupVersion(instance = "patched", execute = execFileSync) {
  const configuration = setupInstances.get(instance);
  if (!configuration) throw new Error("INVALID_SETUP_INSTANCE");
  const args = ["compose", "-p", configuration.project];
  for (const file of configuration.composeFiles) {
    args.push("-f", file);
  }
  args.push(
    "exec", "-T", "directus", "node", "-p",
    "require('/directus/package.json').version"
  );
  const version = execute("docker", args, {
    cwd: integrationDirectory,
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }).trim();
  if (version !== configuration.version) {
    throw new Error("SETUP_INSTANCE_VERSION_MISMATCH");
  }
  return version;
}
const isMain = process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const credentials = Object.fromEntries(
    ["admin", "target", "control"].map((name) => [
      name,
      {
        email: `${name}@example.com`,
        password: process.env[`REVOKX_${name.toUpperCase()}_PASSWORD`]
      }
    ])
  );
  for (const name of ["ADMIN", "TARGET", "CONTROL"]) {
    delete process.env[`REVOKX_${name}_PASSWORD`];
  }
  let stage = "instance-verification";
  try {
    const args = process.argv.slice(2);
    const selection = args[0] ?? "patched";
    if (args.length > 1 || !setupInstances.has(selection)) {
      throw new Error("INVALID_SETUP_ARGUMENTS");
    }
    const configuration = setupInstances.get(selection);
    const version = readSetupVersion(selection);
    stage = "setup";
    const result = await setupDirectusLab(credentials);
    console.log(JSON.stringify({
      instance: configuration.project,
      version,
      ...result
    }, null, 2));
    process.exitCode = result.status === "MATCH" && result.accessVerified ? 0 : 2;
  } catch {
    console.log(JSON.stringify({
      status: "INCONCLUSIVE",
      reason: "SETUP_LAUNCHER_FAILED",
      stage
    }, null, 2));
    process.exitCode = 2;
  } finally {
    for (const credential of Object.values(credentials)) {
      credential.password = undefined;
    }
  }
}