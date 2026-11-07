import test from "node:test";
import assert from "node:assert/strict";
import { observeAccess } from "../src/observe.js";

function fakeClock(start = 0) {
  let time = start;

  return {
    now: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
    }
  };
}

function scenario(targetProbe, controlProbe = async () => "allowed") {
  return {
    revocationWindowMs: 100,
    observationMs: 300,
    pollIntervalMs: 100,
    paths: [
      { id: "target", expected: "denied", probe: targetProbe },
      { id: "control", expected: "allowed", probe: controlProbe }
    ]
  };
}

test("access within the window is allowed, denial at deadline passes", async () => {
  const clock = fakeClock();

  const report = await observeAccess(
    scenario(async () =>
      clock.now() < 100 ? "allowed" : "denied"
    ),
    clock
  );

  assert.equal(report.verdict, "PASS");
  assert.equal(report.results[0].eligibleSamples, 2);

  assert.deepEqual(
    report.samples
      .filter((sample) => sample.pathId === "target")
      .map((sample) => sample.startMs),
    [0, 100, 200]
  );
});

test("access at the deadline is a violation", async () => {
  const report = await observeAccess(
    scenario(async () => "allowed"),
    fakeClock()
  );

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.results[0].verdict, "FAIL");
});

test("later access after an initial denial is detected", async () => {
  const clock = fakeClock();

  const report = await observeAccess(
    scenario(async () =>
      clock.now() === 200 ? "allowed" : "denied"
    ),
    clock
  );

  assert.equal(report.verdict, "FAIL");
});

test("blocking the legitimate control is a failure", async () => {
  const report = await observeAccess(
    scenario(
      async () => "denied",
      async () => "denied"
    ),
    fakeClock()
  );

  assert.equal(report.results[0].verdict, "PASS");
  assert.equal(report.results[1].verdict, "FAIL");
  assert.equal(report.verdict, "FAIL");
});

test("probe errors produce inconclusive observations", async () => {
  const report = await observeAccess(
    scenario(async () => {
      throw new Error("Simulated request failure");
    }),
    fakeClock()
  );

  assert.equal(report.verdict, "INCONCLUSIVE");
});

test("later errors do not erase an observed violation", async () => {
  const clock = fakeClock();

  const report = await observeAccess(
    scenario(async () => {
      if (clock.now() === 200) {
        throw new Error("Simulated timeout");
      }

      return "allowed";
    }),
    clock
  );

  assert.equal(report.verdict, "FAIL");
});

test("an elapsed observation period cannot pass without evidence", async () => {
  const options = scenario(async () => "denied");
  options.referenceMs = 0;

  const report = await observeAccess(options, fakeClock(500));

  assert.equal(report.verdict, "INCONCLUSIVE");
  assert.equal(report.samples.length, 0);
});

test("zero-window policy is supported", async () => {
  const options = scenario(async () => "allowed");
  options.revocationWindowMs = 0;

  const report = await observeAccess(options, fakeClock());

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.results[0].eligibleSamples, 3);
});

test("invalid timing is rejected before probing", async () => {
  const options = scenario(async () => {
    assert.fail("Probe must not run");
  });

  options.observationMs = options.revocationWindowMs;

  await assert.rejects(
    observeAccess(options, fakeClock()),
    /Invalid observation timing/
  );
});