import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function saveReport(
  report,
  { mode, application, directory = "reports" } = {}
) {
  if (!["PASS", "FAIL", "INCONCLUSIVE"].includes(report?.verdict)) {
    throw new Error("Invalid report verdict");
  }

  let applicationDetails;

  if (application === undefined) {
    if (!["fixed", "vulnerable"].includes(mode)) {
      throw new Error("Invalid report mode");
    }

    applicationDetails = {
      name: "revokx-demo",
      mode
    };
  } else {
    if (
      application === null ||
      typeof application !== "object" ||
      Array.isArray(application) ||
      typeof application.name !== "string" ||
      application.name.trim().length === 0 ||
      typeof application.version !== "string" ||
      application.version.trim().length === 0
    ) {
      throw new Error("Application name and version are required");
    }

    if (mode !== undefined) {
      throw new Error("Provide application metadata or demo mode, not both");
    }

    applicationDetails = {
      name: application.name.trim(),
      version: application.version.trim()
    };
  }

  const createdAt = new Date().toISOString();

  const document = {
    schemaVersion: 1,
    createdAt,
    application: applicationDetails,
    report
  };

  const folder = resolve(directory);
  const timestamp = createdAt.replace(/[:.]/g, "-");
  const filename = `${timestamp}-${randomUUID()}.json`;
  const filePath = join(folder, filename);
  const contents = JSON.stringify(document, null, 2) + "\n";

  await mkdir(folder, { recursive: true });
  await writeFile(filePath, contents, { flag: "wx" });

  return filePath;
}