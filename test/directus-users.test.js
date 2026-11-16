import test from "node:test";
import assert from "node:assert/strict";
import { createDirectusClient } from "../integrations/directus/client.js";
const userId = "11111111-1111-4111-8111-111111111111";
async function createSession(t, handler) {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.pathname === "/auth/login") {
      return new Response(JSON.stringify({ data: { expires: 60000 } }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "directus_session_token=synthetic-admin; Path=/; HttpOnly"
        }
      });
    }
    return handler(parsedUrl, options);
  });
  return createDirectusClient().login({
    email: "admin@example.com",
    password: "synthetic-test-password"
  });
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
test("Directus users: lookup encodes an exact email filter and limits returned fields", async (t) => {
  let captured;
  const session = await createSession(t, (url, options) => {
    captured = { url, options };
    return json({ data: [{ id: userId }] });
  });
  const result = await session.findUsersByEmail("target+lab@example.com");
  assert.equal(captured.url.pathname, "/users");
  assert.equal(captured.url.searchParams.get("fields"), "id,email,status,role");
  assert.equal(captured.url.searchParams.get("limit"), "2");
  assert.deepEqual(JSON.parse(captured.url.searchParams.get("filter")), {
    email: { _eq: "target+lab@example.com" }
  });
  assert.equal(captured.options.headers.Cookie, "directus_session_token=synthetic-admin");
  assert.deepEqual(result.body.data, [{ id: userId }]);
});
test("Directus users: identity and user reads use the preserved session", async (t) => {
  const paths = [];
  const session = await createSession(t, (url, options) => {
    paths.push(url.pathname);
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Cookie, "directus_session_token=synthetic-admin");
    return json({ data: { id: userId, status: "active" } });
  });
  await session.readIdentity();
  await session.readUser(userId);
  assert.deepEqual(paths, ["/users/me", `/users/${userId}`]);
});
test("Directus users: status update sends only status and does not assume persistence", async (t) => {
  const calls = [];
  const session = await createSession(t, (url, options) => {
    calls.push({ path: url.pathname, method: options.method, body: options.body });
    if (options.method === "PATCH") {
      return json({ data: { id: userId, status: "suspended" } });
    }
    return json({ data: { id: userId, status: "active" } });
  });
  const update = await session.setUserStatus(userId, "suspended");
  const verification = await session.readUser(userId);
  assert.equal(update.body.data.status, "suspended");
  assert.equal(verification.body.data.status, "active");
  assert.deepEqual(calls, [
    {
      path: `/users/${userId}`,
      method: "PATCH",
      body: JSON.stringify({ status: "suspended" })
    },
    {
      path: `/users/${userId}`,
      method: "GET",
      body: undefined
    }
  ]);
});
test("Directus users: invalid IDs and unsupported statuses send no requests", async (t) => {
  let calls = 0;
  const session = await createSession(t, () => {
    calls++;
    return json({});
  });
  assert.throws(() => session.readUser("../me"), /valid user UUID/);
  assert.throws(() => session.setUserStatus("me", "suspended"), /valid user UUID/);
  assert.throws(() => session.setUserStatus(userId, "deleted"), /Only active and suspended/);
  assert.throws(() => session.findUsersByEmail(" "), /Email is required/);
  assert.equal(calls, 0);
});
test("Directus users: rejected updates remain visible to the caller", async (t) => {
  const body = {
    errors: [{ extensions: { code: "FORBIDDEN" } }]
  };
  const session = await createSession(t, () => json(body, 403));
  const result = await session.setUserStatus(userId, "suspended");
  assert.deepEqual(result, { status: 403, body });
});