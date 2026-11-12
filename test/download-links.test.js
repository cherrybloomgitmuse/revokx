import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../demo/app.js";

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

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return async (path, options = {}) => {
    const response = await fetch(new URL(path, baseUrl), {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(3000)
    });

    return {
      status: response.status,
      body: await response.json(),
      cookieHeader: response.headers.get("set-cookie")
    };
  };
}

async function login(request, username) {
  const result = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password: `lab-${username}-only`
    })
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.user, { id: username });
  assert.ok(result.cookieHeader);
  assert.match(result.body.csrfToken, /^[a-f0-9]{64}$/);

  return {
    cookie: result.cookieHeader.split(";")[0],
    csrfToken: result.body.csrfToken
  };
}

function authenticatedOptions(identity, method = "GET") {
  return {
    method,
    headers: {
      Cookie: identity.cookie,
      "x-csrf-token": identity.csrfToken
    }
  };
}

async function issueLink(request, identity) {
  const result = await request(
    "/team/download-links",
    authenticatedOptions(identity, "POST")
  );

  assert.equal(result.status, 201);
  assert.match(
    result.body.downloadPath,
    /^\/team\/downloads\/[a-f0-9]{64}$/
  );

  return result.body.downloadPath;
}

for (const mode of ["fixed", "vulnerable"]) {
  test(`${mode}: saved links follow the expected removal policy`, async (t) => {
    const request = await startTestServer(t, mode);

    const owner = await login(request, "owner");
    const target = await login(request, "target");
    const remaining = await login(request, "remaining");

    const baseline = await request(
      "/team/file",
      authenticatedOptions(owner)
    );

    assert.equal(baseline.status, 200);
    assert.equal(baseline.body.file.id, "project-notes");
    assert.match(
      baseline.body.file.content,
      /^Confidential lab fixture: /
    );

    const targetLink = await issueLink(request, target);
    const ownerLink = await issueLink(request, owner);
    const remainingLink = await issueLink(request, remaining);

    assert.equal(
      new Set([targetLink, ownerLink, remainingLink]).size,
      3
    );

    // No cookies: these requests exercise bearer-link access.
    for (const path of [targetLink, ownerLink, remainingLink]) {
      const result = await request(path);

      assert.equal(result.status, 200);
      assert.deepEqual(result.body, baseline.body);
    }

    const removal = await request(
      "/team/members/target",
      authenticatedOptions(owner, "DELETE")
    );

    assert.equal(removal.status, 200);
    assert.deepEqual(removal.body, {
      removedUserId: "target"
    });

    // Verify membership independently of the removal response.
    const membership = await request(
      "/team/members",
      authenticatedOptions(owner)
    );

    assert.equal(membership.status, 200);
    assert.deepEqual(
      [...membership.body.memberIds].sort(),
      ["owner", "remaining"]
    );

    // Replay exactly the same link issued before removal.
    const replay = await request(targetLink);

    if (mode === "fixed") {
      assert.equal(replay.status, 403);
      assert.deepEqual(replay.body, {
        error: "TEAM_ACCESS_DENIED"
      });
    } else {
      assert.equal(replay.status, 200);
      assert.deepEqual(replay.body, baseline.body);
    }

    // Unaffected members' existing links must still work.
    for (const path of [ownerLink, remainingLink]) {
      const result = await request(path);

      assert.equal(result.status, 200);
      assert.deepEqual(result.body, baseline.body);
    }

    const session = await request(
      "/auth/me",
      authenticatedOptions(target)
    );

    assert.equal(session.status, 200);
    assert.deepEqual(session.body, {
      user: { id: "target" }
    });

    // Neither mode allows a removed member to create new links.
    const newLink = await request(
      "/team/download-links",
      authenticatedOptions(target, "POST")
    );

    assert.equal(newLink.status, 403);
    assert.deepEqual(newLink.body, {
      error: "TEAM_ACCESS_DENIED"
    });
  });

  test(`${mode}: link creation and invalid-token checks`, async (t) => {
    const request = await startTestServer(t, mode);

    const anonymous = await request("/team/download-links", {
      method: "POST"
    });

    assert.equal(anonymous.status, 401);
    assert.deepEqual(anonymous.body, {
      error: "AUTH_REQUIRED"
    });

    const target = await login(request, "target");

    for (const csrfToken of [undefined, "incorrect-token"]) {
      const headers = { Cookie: target.cookie };

      if (csrfToken !== undefined) {
        headers["x-csrf-token"] = csrfToken;
      }

      const result = await request("/team/download-links", {
        method: "POST",
        headers
      });

      assert.equal(result.status, 403);
      assert.deepEqual(result.body, {
        error: "CSRF_INVALID"
      });
    }

    // No links have been successfully issued in this instance.
    for (const token of ["invalid", "0".repeat(64)]) {
      const result = await request(`/team/downloads/${token}`);

      assert.equal(result.status, 404);
      assert.deepEqual(result.body, {
        error: "LINK_NOT_FOUND"
      });
    }

    const validLink = await issueLink(request, target);
    const validDownload = await request(validLink);
    const baseline = await request(
      "/team/file",
      authenticatedOptions(target)
    );

    assert.equal(validDownload.status, 200);
    assert.equal(baseline.status, 200);
    assert.deepEqual(validDownload.body, baseline.body);
  });
}