import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { repeatDirectusLab } from "./repeat.js";
const credentials = {};
try {
  const args = process.argv.slice(2);
  if (
    args.length !== 1 ||
    !["setup-original", "setup"].includes(args[0])
  ) {
    throw new Error("INVALID_SELECTION");
  }
  for (const account of ["admin", "target", "control"]) {
    credentials[account] = {
      email: `${account}@example.com`,
      password: process.env[`REVOKX_${account.toUpperCase()}_PASSWORD`]
    };
  }
  for (const account of ["ADMIN", "TARGET", "CONTROL"]) {
    delete process.env[`REVOKX_${account}_PASSWORD`];
  }
  if (Object.values(credentials).some(
    (credential) => typeof credential.password !== "string" ||
      credential.password.length === 0
  )) {
    throw new Error("CREDENTIALS_REQUIRED");
  }
  const summary = await repeatDirectusLab(credentials, {
    instance: args[0],
    repetitions: 5
  });
  const createdAt = new Date().toISOString();
  const directory = fileURLToPath(
    new URL("../../reports/directus/repeats/", import.meta.url)
  );
  const filename = `${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`;
  const summaryPath = join(directory, filename);
  await mkdir(directory, { recursive: true });
  await writeFile(summaryPath, JSON.stringify({
    schemaVersion: 1,
    kind: "directus-repeat-summary",
    createdAt,
    summary
  }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ summaryPath, summary }, null, 2));
  process.exitCode = summary.status !== "COMPLETED"
    ? 2
    : summary.matchingVerdicts === summary.requestedRuns
      ? 0
      : 1;
} catch {
  console.error("REPEAT_LAUNCH_FAILED: check selection, credentials, and report storage.");
  process.exitCode = 2;
} finally {
  for (const account of ["ADMIN", "TARGET", "CONTROL"]) {
    delete process.env[`REVOKX_${account}_PASSWORD`];
  }
  for (const credential of Object.values(credentials)) {
    credential.password = undefined;
  }
}