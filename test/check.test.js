import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../demo/app.js";
import {
  checkRevocation,
  classifyFileResponse
} from "../demo/check.js";

for (const mode of ["fixed", "vulnerable"]) {
  test(`checker evaluates ${mode} without receiving its mode`, async (t) => {
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

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const report = await checkRevocation(baseUrl);

    assert.equal(report.membershipRemovalVerified, true);

    if (mode === "fixed") {
      assert.equal(report.verdict, "PASS");
      assert.equal(report.targetAccess, "denied");
      assert.equal(report.ownerAccess, "allowed");
      assert.equal(report.remainingAccess, "allowed");
      assert.equal(report.targetStillAuthenticated, true);
    } else {
      assert.equal(report.verdict, "FAIL");
      assert.equal(report.reason, "PROTECTED_CONTENT_AFTER_REMOVAL");
      assert.equal(report.targetAccess, "allowed");
    }
  });
}

test("protected content overrides misleading error status codes", () => {
  const file = {
    id: "project-notes",
    content: "unique-test-secret"
  };

  for (const status of [200, 403, 500]) {
    assert.equal(
      classifyFileResponse(
        { status, body: { file } },
        file
      ),
      "allowed"
    );
  }
});

test("unexpected responses are not treated as successful revocation", () => {
  const file = {
    id: "project-notes",
    content: "unique-test-secret"
  };

  const ambiguousResponses = [
    { status: 200, body: null },
    { status: 500, body: { error: "INTERNAL_ERROR" } },
    { status: 403, body: { error: "CSRF_INVALID" } },
    { status: 401, body: { error: "AUTH_REQUIRED" } },
    { status: 200, body: { file: { id: file.id } } }
  ];

  for (const response of ambiguousResponses) {
    assert.equal(
      classifyFileResponse(response, file),
      "inconclusive"
    );
  }

  assert.equal(
    classifyFileResponse(
      {
        status: 403,
        body: { error: "TEAM_ACCESS_DENIED" }
      },
      file
    ),
    "denied"
  );
});