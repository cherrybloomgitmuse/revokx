import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function saveReport(
  report,
  { mode, directory = "reports" }
) {
  if (!["fixed", "vulnerable"].includes(mode)) {
    throw new Error("Invalid report mode");
  }

  if (!["PASS", "FAIL", "INCONCLUSIVE"].includes(report?.verdict)) {
    throw new Error("Invalid report verdict");
  }

  const createdAt = new Date().toISOString();

  const document = {
    schemaVersion: 1,
    createdAt,
    application: {
      name: "revokx-demo",
      mode
    },
    report
  };

  const contents = JSON.stringify(document, null, 2) + "\n";
  const folder = resolve(directory);
  const timestamp = createdAt.replace(/[:.]/g, "-");
  const filename = `${timestamp}-${randomUUID()}.json`;
  const filePath = join(folder, filename);

  await mkdir(folder, { recursive: true });
  await writeFile(filePath, contents, { flag: "wx" });

  return filePath;
}