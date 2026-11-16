import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveReport } from "../src/report.js";

async function createReportDirectory(t) {
  const directory = await mkdtemp(
    join(tmpdir(), "revokx-application-report-")
  );

  t.after(() => rm(directory, { recursive: true, force: true }));

  return directory;
}

test("external application report records its name and version", async (t) => {
  const directory = await createReportDirectory(t);

  const report = {
    verdict: "INCONCLUSIVE",
    reason: "TEST_FIXTURE"
  };

  const filePath = await saveReport(report, {
    directory,
    application: {
      name: "directus",
      version: "11.4.0"
    }
  });

  const saved = JSON.parse(await readFile(filePath, "utf8"));

  assert.deepEqual(saved.application, {
    name: "directus",
    version: "11.4.0"
  });

  assert.deepEqual(saved.report, report);
  assert.equal(saved.schemaVersion, 1);
  assert.equal(Number.isNaN(Date.parse(saved.createdAt)), false);
});

test("existing demo report metadata remains compatible", async (t) => {
  const directory = await createReportDirectory(t);

  const filePath = await saveReport(
    { verdict: "PASS" },
    { directory, mode: "fixed" }
  );

  const saved = JSON.parse(await readFile(filePath, "utf8"));

  assert.deepEqual(saved.application, {
    name: "revokx-demo",
    mode: "fixed"
  });
});

test("invalid application metadata creates no report", async (t) => {
  const directory = await createReportDirectory(t);

  const invalidApplications = [
    null,
    [],
    {},
    { name: "directus" },
    { name: "", version: "11.4.0" },
    { name: "directus", version: " " },
    { name: "directus", version: 11 }
  ];

  for (const application of invalidApplications) {
    await assert.rejects(
      saveReport(
        { verdict: "PASS" },
        { directory, application }
      ),
      /Application name and version are required/
    );
  }

  assert.deepEqual(await readdir(directory), []);
});

test("external application metadata cannot be mixed with demo mode", async (t) => {
  const directory = await createReportDirectory(t);

  await assert.rejects(
    saveReport(
      { verdict: "FAIL" },
      {
        directory,
        mode: "vulnerable",
        application: {
          name: "directus",
          version: "11.4.0"
        }
      }
    ),
    /Provide application metadata or demo mode, not both/
  );

  assert.deepEqual(await readdir(directory), []);
});