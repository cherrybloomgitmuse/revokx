import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../demo/app.js";

async function startTestServer(t) {
  const server = createApp().listen(0, "127.0.0.1");

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

  return (path, options = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(3000)
    });
}

async function login(request, username) {
  const response = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password: `lab-${username}-only`
    })
  });

  assert.equal(response.status, 200);

  const cookieHeader = response.headers.get("set-cookie");
  assert.ok(cookieHeader);

  const body = await response.json();
  assert.deepEqual(body.user, { id: username });
  assert.match(body.csrfToken, /^[a-f0-9]{64}$/);

  return {
    cookie: cookieHeader.split(";")[0],
    csrfToken: body.csrfToken
  };
}

async function readFile(request, identity) {
  const response = await request("/team/file", {
    headers: { Cookie: identity.cookie }
  });

  assert.equal(response.status, 200);

  const body = await response.json();

  assert.equal(body.file.id, "project-notes");
  assert.match(body.file.content, /^Confidential lab fixture: /);

  return body;
}

function removalOptions(identity, includeCsrf = true) {
  const headers = { Cookie: identity.cookie };

  if (includeCsrf) {
    headers["x-csrf-token"] = identity.csrfToken;
  }

  return {
    method: "DELETE",
    headers
  };
}

test("removal blocks the old session's file access but preserves legitimate access", async (t) => {
  const request = await startTestServer(t);

  const owner = await login(request, "owner");
  const target = await login(request, "target");
  const remaining = await login(request, "remaining");

  const originalFile = await readFile(request, target);

  assert.deepEqual(
    await readFile(request, owner),
    originalFile
  );

  assert.deepEqual(
    await readFile(request, remaining),
    originalFile
  );

  const removal = await request(
    "/team/members/target",
    removalOptions(owner)
  );

  assert.equal(removal.status, 200);
  assert.deepEqual(await removal.json(), {
    removedUserId: "target"
  });

  // Replay the exact same cookie. Do not log in again.
  const denied = await request("/team/file", {
    headers: { Cookie: target.cookie }
  });

  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), {
    error: "TEAM_ACCESS_DENIED"
  });

  // The account is still authenticated.
  const identity = await request("/auth/me", {
    headers: { Cookie: target.cookie }
  });

  assert.equal(identity.status, 200);
  assert.deepEqual(await identity.json(), {
    user: { id: "target" }
  });

  // Verify the actual file still exists and remains accessible.
  assert.deepEqual(
    await readFile(request, remaining),
    originalFile
  );

  assert.deepEqual(
    await readFile(request, owner),
    originalFile
  );
});

test("a non-owner cannot remove another member", async (t) => {
  const request = await startTestServer(t);

  const target = await login(request, "target");
  const remaining = await login(request, "remaining");

  const originalFile = await readFile(request, remaining);

  const removal = await request(
    "/team/members/remaining",
    removalOptions(target)
  );

  assert.equal(removal.status, 403);
  assert.deepEqual(await removal.json(), {
    error: "OWNER_REQUIRED"
  });

  // A denial response alone is insufficient: check access survived.
  assert.deepEqual(
    await readFile(request, remaining),
    originalFile
  );
});

test("missing CSRF token prevents removal without changing access", async (t) => {
  const request = await startTestServer(t);

  const owner = await login(request, "owner");
  const target = await login(request, "target");

  const originalFile = await readFile(request, target);

  const removal = await request(
    "/team/members/target",
    removalOptions(owner, false)
  );

  assert.equal(removal.status, 403);
  assert.deepEqual(await removal.json(), {
    error: "CSRF_INVALID"
  });

  assert.deepEqual(
    await readFile(request, target),
    originalFile
  );
});

test("anonymous requests cannot read the team file or remove a member", async (t) => {
  const request = await startTestServer(t);

  const target = await login(request, "target");
  const originalFile = await readFile(request, target);

  const fileResponse = await request("/team/file");

  assert.equal(fileResponse.status, 401);
  assert.deepEqual(await fileResponse.json(), {
    error: "AUTH_REQUIRED"
  });

  const removal = await request("/team/members/target", {
    method: "DELETE"
  });

  assert.equal(removal.status, 401);
  assert.deepEqual(await removal.json(), {
    error: "AUTH_REQUIRED"
  });

  assert.deepEqual(
    await readFile(request, target),
    originalFile
  );
});