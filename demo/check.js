import { performance } from "node:perf_hooks";
import { observeAccess } from "../src/observe.js";

export function classifyFileResponse(response, expectedFile) {
  const actualFile = response.body?.file;
  // Protected content proves access, even with an error status.
  if (
    actualFile?.id === expectedFile.id &&
    actualFile?.content === expectedFile.content
  ) {
    return "allowed";
  }

  const body = response.body;
  const onlyError =
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).length === 1;

  if (
    onlyError &&
    response.status === 403 &&
    body.error === "TEAM_ACCESS_DENIED"
  ) {
    return "denied";
  }

  return "inconclusive";
}

export async function checkRevocation(baseUrl, settings = {}) {
  const timing = {
    revocationWindowMs: settings.revocationWindowMs ?? 0,
    observationMs: settings.observationMs ?? 1000,
    pollIntervalMs: settings.pollIntervalMs ?? 100,
    requestTimeoutMs: settings.requestTimeoutMs ?? 1500
  };

  if (
    !Number.isFinite(timing.revocationWindowMs) ||
    timing.revocationWindowMs < 0 ||
    !Number.isFinite(timing.observationMs) ||
    timing.observationMs <= timing.revocationWindowMs ||
    !Number.isFinite(timing.pollIntervalMs) ||
    timing.pollIntervalMs <= 0 ||
    !Number.isFinite(timing.requestTimeoutMs) ||
    timing.requestTimeoutMs <= 0
  ) {
    return {
      verdict: "INCONCLUSIVE",
      reason: "INVALID_TIMING_CONFIGURATION"
    };
  }

  let stage = "setup";

  async function request(path, options = {}) {
    const response = await fetch(new URL(path, baseUrl), {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(timing.requestTimeoutMs)
    });

    const text = await response.text();
    let body = null;

    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON responses remain ambiguous.
    }

    return {
      status: response.status,
      body,
      cookieHeader: response.headers.get("set-cookie")
    };
  }

  function requireCondition(condition) {
    if (!condition) {
      throw new Error("Verification failed");
    }
  }

  async function login(username) {
    const result = await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password: `lab-${username}-only`
      })
    });

    requireCondition(
      result.status === 200 &&
      result.body?.user?.id === username &&
      typeof result.body?.csrfToken === "string" &&
      result.cookieHeader?.startsWith("revokx.sid=")
    );

    return {
      cookie: result.cookieHeader.split(";")[0],
      csrfToken: result.body.csrfToken
    };
  }

  function readFile(identity) {
    return request("/team/file", {
      headers: { Cookie: identity.cookie }
    });
  }

  async function issueLink(identity) {
    const result = await request("/team/download-links", {
      method: "POST",
      headers: {
        Cookie: identity.cookie,
        "x-csrf-token": identity.csrfToken
      }
    });

    const path = result.body?.downloadPath;

    // Accept only the expected local route, never an external URL.
    requireCondition(
      result.status === 201 &&
      typeof path === "string" &&
      /^\/team\/downloads\/[a-f0-9]{64}$/.test(path)
    );

    return path;
  }

  function readLink(path) {
    // Intentionally no Cookie header.
    return request(path);
  }

  async function readMembers(owner) {
    const result = await request("/team/members", {
      headers: { Cookie: owner.cookie }
    });

    requireCondition(
      result.status === 200 &&
      Array.isArray(result.body?.memberIds) &&
      result.body.memberIds.every((id) => typeof id === "string")
    );

    return result.body.memberIds;
  }

  try {
    const owner = await login("owner");
    const target = await login("target");
    const remaining = await login("remaining");

    stage = "baseline";

    const membersBefore = await readMembers(owner);

    requireCondition(
      ["owner", "target", "remaining"].every((id) =>
        membersBefore.includes(id)
      )
    );

    const baseline = await readFile(owner);
    const expectedFile = baseline.body?.file;

    requireCondition(
      baseline.status === 200 &&
      expectedFile?.id === "project-notes" &&
      typeof expectedFile.content === "string" &&
      expectedFile.content.startsWith("Confidential lab fixture: ")
    );

    for (const identity of [target, remaining]) {
      requireCondition(
        classifyFileResponse(
          await readFile(identity),
          expectedFile
        ) === "allowed"
      );
    }

    stage = "link-baseline";

    // Capture credentials before the permission change.
    const targetLink = await issueLink(target);
    const ownerLink = await issueLink(owner);
    const remainingLink = await issueLink(remaining);

    for (const path of [targetLink, ownerLink, remainingLink]) {
      requireCondition(
        classifyFileResponse(
          await readLink(path),
          expectedFile
        ) === "allowed"
      );
    }

    stage = "removal";

    const removal = await request("/team/members/target", {
      method: "DELETE",
      headers: {
        Cookie: owner.cookie,
        "x-csrf-token": owner.csrfToken
      }
    });

    requireCondition(
      removal.status === 200 &&
      removal.body?.removedUserId === "target"
    );

    // Client timing starts after the response is consumed and validated.
    // This is not the server's exact permission-change commit time.
    const referenceMs = performance.now();

    stage = "membership-verification";

    const membersAfter = await readMembers(owner);

    requireCondition(
      !membersAfter.includes("target") &&
      membersAfter.includes("owner") &&
      membersAfter.includes("remaining")
    );

    function contentPath(id, expected, read) {
      return {
        id,
        expected,
        probe: async () =>
          classifyFileResponse(await read(), expectedFile)
      };
    }

    stage = "observation";

    const observation = await observeAccess({
      referenceMs,
      revocationWindowMs: timing.revocationWindowMs,
      observationMs: timing.observationMs,
      pollIntervalMs: timing.pollIntervalMs,
      paths: [
        contentPath("target-file", "denied", () => readFile(target)),
        contentPath("target-link", "denied", () => readLink(targetLink)),
        contentPath("owner-file", "allowed", () => readFile(owner)),
        contentPath("owner-link", "allowed", () => readLink(ownerLink)),
        contentPath("remaining-file", "allowed", () =>
          readFile(remaining)
        ),
        contentPath("remaining-link", "allowed", () =>
          readLink(remainingLink)
        ),
        {
          id: "target-session",
          expected: "allowed",
          probe: async () => {
            const result = await request("/auth/me", {
              headers: { Cookie: target.cookie }
            });

            if (
              result.status === 200 &&
              result.body?.user?.id === "target"
            ) {
              return "allowed";
            }

            if (
              result.status === 401 &&
              result.body?.error === "AUTH_REQUIRED"
            ) {
              return "denied";
            }

            return "inconclusive";
          }
        }
      ]
    });

    const byId = new Map(
      observation.results.map((result) => [result.pathId, result])
    );

    function accessSummary(pathId) {
      const result = byId.get(pathId);

      if (result.verdict === "INCONCLUSIVE") {
        return "inconclusive";
      }

      if (result.verdict === "PASS") {
        return result.expected;
      }

      return result.expected === "denied" ? "allowed" : "denied";
    }

    const targetAccess = accessSummary("target-file");
    const targetLinkAccess = accessSummary("target-link");
    const ownerAccess = accessSummary("owner-file");
    const ownerLinkAccess = accessSummary("owner-link");
    const remainingAccess = accessSummary("remaining-file");
    const remainingLinkAccess = accessSummary("remaining-link");
    const sessionAccess = accessSummary("target-session");

    let reason = "OBSERVED_POLICY_SATISFIED";

    if (
      targetAccess === "allowed" ||
      targetLinkAccess === "allowed"
    ) {
      reason = "PROTECTED_CONTENT_AFTER_REMOVAL";
    } else if (observation.verdict === "FAIL") {
      reason = "LEGITIMATE_ACCESS_DENIED";
    } else if (observation.verdict === "INCONCLUSIVE") {
      reason = "INCOMPLETE_OR_UNEXPECTED_OBSERVATIONS";
    }

    return {
      verdict: observation.verdict,
      reason,
      membershipRemovalVerified: true,
      targetAccess,
      targetLinkAccess,
      ownerAccess,
      ownerLinkAccess,
      remainingAccess,
      remainingLinkAccess,
      targetStillAuthenticated:
        sessionAccess === "inconclusive"
          ? null
          : sessionAccess === "allowed",
      timingReference: "CLIENT_VALIDATED_REMOVAL_RESPONSE",
      timing,
      results: observation.results,
      samples: observation.samples
    };
  } catch {
    return {
      verdict: "INCONCLUSIVE",
      reason: "REQUEST_OR_VERIFICATION_FAILED",
      stage
    };
  }
}