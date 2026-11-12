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

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function overrideAfterRemoval(t, baseUrl, scenario) {
  const originalFetch = globalThis.fetch;
  const cookies = new Map();
  const links = new Map();

  let removed = false;
  let overrideCount = 0;

  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(input);
    const headers = new Headers(options.headers);
    const method = options.method ?? "GET";

    if (url.origin !== new URL(baseUrl).origin) {
      return originalFetch(input, options);
    }

    if (removed) {
      const targetFile =
        url.pathname === "/team/file" &&
        headers.get("cookie") === cookies.get("target");

      const targetLink =
        links.has("target") &&
        url.pathname === links.get("target");

      const remainingLink =
        links.has("remaining") &&
        url.pathname === links.get("remaining");

      const deny =
        (scenario === "link-only-leak" && targetFile) ||
        (scenario === "session-only-leak" && targetLink) ||
        (scenario === "blocked-control" && remainingLink);

      if (deny) {
        overrideCount += 1;

        return jsonResponse(403, {
          error: "TEAM_ACCESS_DENIED"
        });
      }

      if (scenario === "ambiguous-target-link" && targetLink) {
        overrideCount += 1;

        return jsonResponse(500, {
          error: "UNEXPECTED_FAILURE"
        });
      }
    }

    const response = await originalFetch(input, options);

    if (
      url.pathname === "/auth/login" &&
      method === "POST" &&
      response.status === 200
    ) {
      const body = await response.clone().json();
      const cookieHeader = response.headers.get("set-cookie");

      assert.ok(cookieHeader);
      cookies.set(body.user.id, cookieHeader.split(";")[0]);
    }

    if (
      url.pathname === "/team/download-links" &&
      method === "POST" &&
      response.status === 201
    ) {
      const identity = [...cookies.entries()].find(
        ([, cookie]) => cookie === headers.get("cookie")
      );

      assert.ok(identity);

      const body = await response.clone().json();
      links.set(identity[0], body.downloadPath);
    }

    if (
      url.pathname === "/team/members/target" &&
      method === "DELETE" &&
      response.status === 200
    ) {
      removed = true;
    }

    return response;
  });

  return () => overrideCount;
}

const scenarios = [
  {
    id: "link-only-leak",
    name: "saved-link leak fails even when session file access is denied",
    mode: "vulnerable",
    verdict: "FAIL",
    reason: "PROTECTED_CONTENT_AFTER_REMOVAL",
    targetAccess: "denied",
    targetLinkAccess: "allowed",
    remainingLinkAccess: "allowed",
    pathId: "target-link",
    pathVerdict: "FAIL",
    outcome: "allowed"
  },
  {
    id: "session-only-leak",
    name: "session file leak fails even when saved-link access is denied",
    mode: "vulnerable",
    verdict: "FAIL",
    reason: "PROTECTED_CONTENT_AFTER_REMOVAL",
    targetAccess: "allowed",
    targetLinkAccess: "denied",
    remainingLinkAccess: "allowed",
    pathId: "target-file",
    pathVerdict: "FAIL",
    outcome: "allowed"
  },
  {
    id: "blocked-control",
    name: "blocking a legitimate member's link fails the policy",
    mode: "fixed",
    verdict: "FAIL",
    reason: "LEGITIMATE_ACCESS_DENIED",
    targetAccess: "denied",
    targetLinkAccess: "denied",
    remainingLinkAccess: "denied",
    pathId: "remaining-link",
    pathVerdict: "FAIL",
    outcome: "denied"
  },
  {
    id: "ambiguous-target-link",
    name: "unexpected target-link responses remain inconclusive",
    mode: "fixed",
    verdict: "INCONCLUSIVE",
    reason: "INCOMPLETE_OR_UNEXPECTED_OBSERVATIONS",
    targetAccess: "denied",
    targetLinkAccess: "inconclusive",
    remainingLinkAccess: "allowed",
    pathId: "target-link",
    pathVerdict: "INCONCLUSIVE",
    outcome: "inconclusive"
  }
];

for (const scenario of scenarios) {
  test(scenario.name, async (t) => {
    const baseUrl = await startTestServer(t, scenario.mode);
    const getOverrideCount = overrideAfterRemoval(
      t,
      baseUrl,
      scenario.id
    );

    const report = await checkRevocation(baseUrl, {
      observationMs: 1500,
      pollIntervalMs: 50,
      requestTimeoutMs: 3000
    });

    assert.ok(
      getOverrideCount() > 0,
      "The intended response override must actually run"
    );

    assert.equal(report.membershipRemovalVerified, true);
    assert.equal(report.verdict, scenario.verdict);
    assert.equal(report.reason, scenario.reason);

    assert.equal(report.targetAccess, scenario.targetAccess);
    assert.equal(report.targetLinkAccess, scenario.targetLinkAccess);
    assert.equal(
      report.remainingLinkAccess,
      scenario.remainingLinkAccess
    );

    assert.equal(report.ownerAccess, "allowed");
    assert.equal(report.ownerLinkAccess, "allowed");
    assert.equal(report.remainingAccess, "allowed");
    assert.equal(report.targetStillAuthenticated, true);

    const affectedResult = report.results.find(
      (result) => result.pathId === scenario.pathId
    );

    assert.ok(affectedResult);
    assert.ok(affectedResult.eligibleSamples > 0);
    assert.equal(affectedResult.verdict, scenario.pathVerdict);

    const affectedSamples = report.samples.filter(
      (sample) => sample.pathId === scenario.pathId
    );

    assert.ok(affectedSamples.length > 0);
    assert.ok(
      affectedSamples.every(
        (sample) => sample.outcome === scenario.outcome
      )
    );

    // Every other configured check should satisfy its own policy.
    for (const result of report.results) {
      if (result.pathId !== scenario.pathId) {
        assert.equal(
          result.verdict,
          "PASS",
          `Unexpected result for ${result.pathId}`
        );
      }
    }
  });
}