import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

const realClock = {
  now: () => performance.now(),
  sleep: (milliseconds) => delay(milliseconds)
};

export async function observeAccess(options, clock = realClock) {
  const {
    paths,
    revocationWindowMs,
    observationMs,
    pollIntervalMs
  } = options;

  if (
    !Number.isFinite(revocationWindowMs) ||
    revocationWindowMs < 0 ||
    !Number.isFinite(observationMs) ||
    observationMs <= revocationWindowMs ||
    !Number.isFinite(pollIntervalMs) ||
    pollIntervalMs <= 0
  ) {
    throw new Error("Invalid observation timing");
  }

  if (
    !Array.isArray(paths) ||
    !paths.every((path) =>
      typeof path.id === "string" &&
      path.id.length > 0 &&
      typeof path.probe === "function" &&
      ["allowed", "denied"].includes(path.expected)
    ) ||
    new Set(paths.map((path) => path.id)).size !== paths.length ||
    !paths.some((path) => path.expected === "denied") ||
    !paths.some((path) => path.expected === "allowed")
  ) {
    throw new Error("Provide unique paths with target and control checks");
  }

  const referenceMs = options.referenceMs ?? clock.now();

  if (!Number.isFinite(referenceMs) || referenceMs > clock.now()) {
    throw new Error("Invalid timing reference");
  }

  const samples = [];

  while (clock.now() - referenceMs < observationMs) {
    for (const path of paths) {
      const startMs = clock.now() - referenceMs;

      if (startMs >= observationMs) {
        break;
      }

      let outcome = "inconclusive";

      try {
        const observed = await path.probe();

        if (["allowed", "denied", "inconclusive"].includes(observed)) {
          outcome = observed;
        }
      } catch {
        // A request error does not prove access was denied.
      }

      samples.push({
        pathId: path.id,
        startMs,
        endMs: clock.now() - referenceMs,
        outcome
      });
    }

    const remainingMs = observationMs - (clock.now() - referenceMs);

    if (remainingMs > 0) {
      await clock.sleep(Math.min(pollIntervalMs, remainingMs));
    }
  }

  const results = paths.map((path) => {
    const eligible = samples.filter((sample) =>
      sample.pathId === path.id &&
      (path.expected === "allowed" ||
        sample.startMs >= revocationWindowMs)
    );

    const violation = eligible.some((sample) =>
      sample.outcome !== "inconclusive" &&
      sample.outcome !== path.expected
    );

    let verdict = "PASS";

    if (violation) {
      verdict = "FAIL";
    } else if (
      eligible.length === 0 ||
      eligible.some((sample) => sample.outcome === "inconclusive")
    ) {
      verdict = "INCONCLUSIVE";
    }

    return {
      pathId: path.id,
      expected: path.expected,
      eligibleSamples: eligible.length,
      verdict
    };
  });

  const verdict = results.some((result) => result.verdict === "FAIL")
    ? "FAIL"
    : results.some((result) => result.verdict === "INCONCLUSIVE")
      ? "INCONCLUSIVE"
      : "PASS";

  return {
    verdict,
    timing: { revocationWindowMs, observationMs, pollIntervalMs },
    results,
    samples
  };
}