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

function loginOptions(password, cookie) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (cookie) {
    headers.Cookie = cookie;
  }

  return {
    method: "POST",
    headers,
    body: JSON.stringify({
      username: "target",
      password
    })
  };
}

function readCookie(response) {
  const header = response.headers.get("set-cookie");
  assert.ok(header, "Login must issue a session cookie");
  return header.split(";")[0];
}

test("missing session cannot access identity", async (t) => {
  const request = await startTestServer(t);
  const response = await request("/auth/me");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "AUTH_REQUIRED"
  });
});

test("wrong password does not create a login session", async (t) => {
  const request = await startTestServer(t);

  const response = await request(
    "/auth/login",
    loginOptions("wrong-password")
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "INVALID_CREDENTIALS"
  });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("login works and logout invalidates the preserved cookie", async (t) => {
  const request = await startTestServer(t);

  const login = await request(
    "/auth/login",
    loginOptions("lab-target-only")
  );

  assert.equal(login.status, 200);

  const cookie = readCookie(login);
  const loginBody = await login.json();

  assert.deepEqual(loginBody.user, { id: "target" });
  assert.match(loginBody.csrfToken, /^[a-f0-9]{64}$/);

  const cookieHeader = login.headers.get("set-cookie");
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Strict/i);

  const before = await request("/auth/me", {
    headers: { Cookie: cookie }
  });

  assert.equal(before.status, 200);
  assert.deepEqual(await before.json(), {
    user: { id: "target" }
  });

  const rejectedLogout = await request("/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie }
  });

  assert.equal(rejectedLogout.status, 403);
  assert.deepEqual(await rejectedLogout.json(), {
    error: "CSRF_INVALID"
  });

  const stillLoggedIn = await request("/auth/me", {
    headers: { Cookie: cookie }
  });

  assert.equal(stillLoggedIn.status, 200);
  assert.deepEqual(await stillLoggedIn.json(), {
    user: { id: "target" }
  });

  const logout = await request("/auth/logout", {
    method: "POST",
    headers: {
      Cookie: cookie,
      "x-csrf-token": loginBody.csrfToken
    }
  });

  assert.equal(logout.status, 204);

  // Deliberately replay the original cookie after logout.
  const after = await request("/auth/me", {
    headers: { Cookie: cookie }
  });

  assert.equal(after.status, 401);
  assert.deepEqual(await after.json(), {
    error: "AUTH_REQUIRED"
  });
});

test("successful login rotates an existing session", async (t) => {
  const request = await startTestServer(t);

  const first = await request(
    "/auth/login",
    loginOptions("lab-target-only")
  );

  assert.equal(first.status, 200);
  const oldCookie = readCookie(first);
  await first.json();

  const second = await request(
    "/auth/login",
    loginOptions("lab-target-only", oldCookie)
  );

  assert.equal(second.status, 200);
  const newCookie = readCookie(second);
  await second.json();

  assert.notEqual(newCookie, oldCookie);

  const oldSession = await request("/auth/me", {
    headers: { Cookie: oldCookie }
  });

  assert.equal(oldSession.status, 401);
  assert.deepEqual(await oldSession.json(), {
    error: "AUTH_REQUIRED"
  });

  const newSession = await request("/auth/me", {
    headers: { Cookie: newCookie }
  });

  assert.equal(newSession.status, 200);
  assert.deepEqual(await newSession.json(), {
    user: { id: "target" }
  });
});