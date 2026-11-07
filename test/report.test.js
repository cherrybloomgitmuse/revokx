import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveReport } from "../src/report.js";

async function temporaryFolder(t) {
  const folder = await mkdtemp(
    join(tmpdir(), "revokx-report-")
  );

  t.after(() =>
    rm(folder, { recursive: true, force: true })
  );

  return folder;
}

test("saved JSON retains verdict, timing, and observations", async (t) => {
  const directory = await temporaryFolder(t);

  const report = {
    verdict: "FAIL",
    reason: "PROTECTED_CONTENT_AFTER_REMOVAL",
    timing: {
      revocationWindowMs: 0
    },
    samples: [
      {
        pathId: "target-file",
        startMs: 10,
        endMs: 12,
        outcome: "allowed"
      }
    ]
  };

  const filePath = await saveReport(report, {
    mode: "vulnerable",
    directory
  });

  const saved = JSON.parse(
    await readFile(filePath, "utf8")
  );

  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.application.mode, "vulnerable");
  assert.equal(saved.application.name, "revokx-demo");
  assert.ok(Number.isFinite(Date.parse(saved.createdAt)));
  assert.deepEqual(saved.report, report);
});

test("repeated saves create separate files", async (t) => {
  const directory = await temporaryFolder(t);

  const first = await saveReport(
    { verdict: "PASS" },
    { mode: "fixed", directory }
  );

  const second = await saveReport(
    { verdict: "INCONCLUSIVE" },
    { mode: "fixed", directory }
  );

  assert.notEqual(first, second);
  assert.equal((await readdir(directory)).length, 2);

  assert.equal(
    JSON.parse(await readFile(first, "utf8")).report.verdict,
    "PASS"
  );

  assert.equal(
    JSON.parse(await readFile(second, "utf8")).report.verdict,
    "INCONCLUSIVE"
  );
});

test("a filesystem write failure is propagated", async (t) => {
  const folder = await temporaryFolder(t);
  const blockedPath = join(folder, "regular-file");

  await writeFile(blockedPath, "not a directory");

  await assert.rejects(
    saveReport(
      { verdict: "PASS" },
      { mode: "fixed", directory: blockedPath }
    )
  );
});