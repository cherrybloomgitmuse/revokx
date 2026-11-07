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

for (const mode of ["fixed", "vulnerable"]) {
  test(`${mode}: verify file access after membership removal`, async (t) => {
    const request = await startTestServer(t, mode);

    const owner = await login(request, "owner");
    const target = await login(request, "target");
    const remaining = await login(request, "remaining");

    const originalFile = await readFile(request, target);

    assert.deepEqual(
      await readFile(request, remaining),
      originalFile
    );

    const removal = await request("/team/members/target", {
      method: "DELETE",
      headers: {
        Cookie: owner.cookie,
        "x-csrf-token": owner.csrfToken
      }
    });

    assert.equal(removal.status, 200);
    assert.deepEqual(await removal.json(), {
      removedUserId: "target"
    });

    // Preserve the exact pre-removal cookie.
    const afterRemoval = await request("/team/file", {
      headers: { Cookie: target.cookie }
    });

    const afterRemovalBody = await afterRemoval.json();

    if (mode === "fixed") {
      assert.equal(afterRemoval.status, 403);
      assert.deepEqual(afterRemovalBody, {
        error: "TEAM_ACCESS_DENIED"
      });
    } else {
      // Prove that protected content actually leaked.
      assert.equal(afterRemoval.status, 200);
      assert.deepEqual(afterRemovalBody, originalFile);
    }

    const identity = await request("/auth/me", {
      headers: { Cookie: target.cookie }
    });

    assert.equal(identity.status, 200);
    assert.deepEqual(await identity.json(), {
      user: { id: "target" }
    });

    assert.deepEqual(
      await readFile(request, remaining),
      originalFile
    );

    assert.deepEqual(
      await readFile(request, owner),
      originalFile
    );

    // Confirm removal persisted: the target cannot remove itself.
    const unauthorizedRemoval = await request(
      "/team/members/target",
      {
        method: "DELETE",
        headers: {
          Cookie: target.cookie,
          "x-csrf-token": target.csrfToken
        }
      }
    );

    assert.equal(unauthorizedRemoval.status, 403);
    assert.deepEqual(await unauthorizedRemoval.json(), {
      error: "OWNER_REQUIRED"
    });
  });
}

test("an unsupported demo mode is rejected", () => {
  assert.throws(
    () => createApp({ mode: "typo" }),
    /Unsupported demo mode/
  );
});