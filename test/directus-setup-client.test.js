import test from "node:test";
import assert from "node:assert/strict";
import { createDirectusClient } from "../integrations/directus/client.js";
async function startSession(t, handleRequest) {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.pathname === "/auth/login") {
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "directus_session_token=synthetic-cookie; HttpOnly"
        }
      });
    }
    return handleRequest(url, options);
  });
  return createDirectusClient().login({
    email: "admin@example.com",
    password: "synthetic-test-password"
  });
}
test("setup reads encode filters and preserve the issued session", async (t) => {
  const filter = { name: { _eq: "REVOKX Reader & Test" } };
  const session = await startSession(t, (url, options) => {
    assert.equal(url.origin, "http://127.0.0.1:8055");
    assert.equal(url.pathname, "/roles");
    assert.deepEqual(JSON.parse(url.searchParams.get("filter")), filter);
    assert.equal(url.searchParams.get("limit"), "2");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Cookie, "directus_session_token=synthetic-cookie");
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify({ data: [] }));
  });
  const result = await session.readSetupResource("roles", {
    filter: JSON.stringify(filter),
    limit: "2"
  });
  assert.deepEqual(result, { status: 200, body: { data: [] } });
});
test("setup creation preserves API errors instead of claiming success", async (t) => {
  const payload = { name: "REVOKX Reader" };
  const body = { errors: [{ extensions: { code: "FORBIDDEN" } }] };
  const session = await startSession(t, (url, options) => {
    assert.equal(url.pathname, "/roles");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), payload);
    assert.equal(options.headers.Cookie, "directus_session_token=synthetic-cookie");
    return new Response(JSON.stringify(body), { status: 403 });
  });
  const result = await session.createSetupResource("roles", payload);
  assert.deepEqual(result, { status: 403, body });
  assert.equal(Object.hasOwn(result, "cookies"), false);
});
test("setup rejects arbitrary destinations and malformed input before requests", async (t) => {
  const session = await startSession(t, () => {
    assert.fail("Invalid setup input must not send a request");
  });
  for (const resource of [
    "http://example.com/users",
    "//example.com/users",
    "../users",
    "unknown"
  ]) {
    assert.throws(() => session.readSetupResource(resource));
    assert.throws(() => session.createSetupResource(resource, {}));
  }
  assert.throws(() => session.readSetupResource("users", { access_token: "test" }));
  assert.throws(() => session.readSetupResource("users", { limit: 2 }));
  assert.throws(() => session.readSetupResource("users", null));
  assert.throws(() => session.createSetupResource("users", null));
  assert.throws(() => session.createSetupResource("users", []));
});