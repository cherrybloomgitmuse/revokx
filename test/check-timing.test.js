import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../demo/app.js";
import { checkRevocation } from "../demo/check.js";

async function startTestServer(t, mode) {
  const server = createApp({ mode }).listen(0, "127.0.0.1");

  t.after(async () => {
    if (!server.listening) {
      return;
    }

    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });

      server.closeAllConnections();
    });
  });

  await once(server, "listening");

  return `http://127.0.0.1:${server.address().port}`;
}

for (const mode of ["fixed", "vulnerable"]) {
  test(`timed HTTP checker reports evidence for ${mode} mode`, async (t) => {
    const baseUrl = await startTestServer(t, mode);

    const report = await checkRevocation(baseUrl, {
      revocationWindowMs: 100,
      observationMs: 1000,
      pollIntervalMs: 100,
      requestTimeoutMs: 1500
    });

    assert.equal(
      report.verdict,
      mode === "fixed" ? "PASS" : "FAIL"
    );

    assert.equal(
      report.timingReference,
      "CLIENT_VALIDATED_REMOVAL_RESPONSE"
    );

    assert.equal(report.timing.revocationWindowMs, 100);
    assert.equal(report.membershipRemovalVerified, true);
    assert.equal(report.ownerAccess, "allowed");
    assert.equal(report.remainingAccess, "allowed");
    assert.equal(report.targetStillAuthenticated, true);

    const targetSamples = report.samples.filter(
      (sample) => sample.pathId === "target-file"
    );

    assert.ok(
      targetSamples.length >= 2,
      "The run must contain repeated target probes"
    );

    const eligibleSamples = targetSamples.filter(
      (sample) => sample.startMs >= 100
    );

    assert.ok(
      eligibleSamples.length > 0,
      "At least one target probe must start at or after the deadline"
    );

    const targetResult = report.results.find(
      (result) => result.pathId === "target-file"
    );

    assert.equal(
      targetResult.eligibleSamples,
      eligibleSamples.length
    );

    for (const sample of report.samples) {
      assert.ok(Number.isFinite(sample.startMs));
      assert.ok(Number.isFinite(sample.endMs));
      assert.ok(sample.startMs >= 0);
      assert.ok(sample.startMs < 1000);
      assert.ok(sample.endMs >= sample.startMs);
    }

    if (mode === "vulnerable") {
      assert.equal(
        report.reason,
        "PROTECTED_CONTENT_AFTER_REMOVAL"
      );

      assert.ok(
        eligibleSamples.some(
          (sample) => sample.outcome === "allowed"
        )
      );
    } else {
      assert.ok(
        eligibleSamples.every(
          (sample) => sample.outcome === "denied"
        )
      );
    }
  });
}

test("invalid timing is rejected before making requests", async () => {
  const report = await checkRevocation("not-a-valid-url", {
    revocationWindowMs: 1000,
    observationMs: 500
  });

  assert.deepEqual(report, {
    verdict: "INCONCLUSIVE",
    reason: "INVALID_TIMING_CONFIGURATION"
  });
});