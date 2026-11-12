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
  test(`${mode}: checker observes preserved bearer links`, async (t) => {
    const baseUrl = await startTestServer(t, mode);
    const originalFetch = globalThis.fetch;

    const issuedPaths = [];
    const downloads = [];
    let removalAcknowledged = false;

    t.mock.method(globalThis, "fetch", async (input, options = {}) => {
      const url = new URL(input);
      const response = await originalFetch(input, options);

      if (
        url.pathname === "/team/download-links" &&
        options.method === "POST"
      ) {
        assert.equal(removalAcknowledged, false);
        assert.equal(response.status, 201);

        const body = await response.clone().json();
        issuedPaths.push(body.downloadPath);
      }

      if (
        url.pathname === "/team/members/target" &&
        options.method === "DELETE" &&
        response.status === 200
      ) {
        removalAcknowledged = true;
      }

      if (url.pathname.startsWith("/team/downloads/")) {
        const headers = new Headers(options.headers);

        assert.equal(headers.has("cookie"), false);
        assert.ok(issuedPaths.includes(url.pathname));

        downloads.push({
          path: url.pathname,
          afterRemoval: removalAcknowledged
        });
      }

      return response;
    });

    const report = await checkRevocation(baseUrl, {
      observationMs: 1500,
      pollIntervalMs: 50,
      requestTimeoutMs: 3000
    });

    assert.equal(
      report.verdict,
      mode === "fixed" ? "PASS" : "FAIL"
    );

    assert.equal(report.membershipRemovalVerified, true);
    assert.equal(report.targetStillAuthenticated, true);

    assert.equal(
      report.targetLinkAccess,
      mode === "fixed" ? "denied" : "allowed"
    );

    assert.equal(report.ownerLinkAccess, "allowed");
    assert.equal(report.remainingLinkAccess, "allowed");

    assert.equal(issuedPaths.length, 3);
    assert.equal(new Set(issuedPaths).size, 3);

    for (const path of issuedPaths) {
      assert.ok(
        downloads.some(
          (download) =>
            download.path === path &&
            !download.afterRemoval
        )
      );

      assert.ok(
        downloads.some(
          (download) =>
            download.path === path &&
            download.afterRemoval
        )
      );
    }

    for (const pathId of [
      "target-link",
      "owner-link",
      "remaining-link"
    ]) {
      const result = report.results.find(
        (entry) => entry.pathId === pathId
      );

      assert.ok(result);
      assert.ok(result.eligibleSamples > 0);

      assert.equal(
        result.verdict,
        mode === "vulnerable" && pathId === "target-link"
          ? "FAIL"
          : "PASS"
      );
    }

    // Check actual generated secrets, not just field names.
    const serialized = JSON.stringify(report);

    for (const path of issuedPaths) {
      const token = path.split("/").at(-1);

      assert.equal(serialized.includes(path), false);
      assert.equal(serialized.includes(token), false);
    }
  });
}