import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createDirectusClient } from "../integrations/directus/client.js";

async function startServer(t, handler) {
  const server = createServer(handler);

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });

      server.closeAllConnections();
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return `http://127.0.0.1:${server.address().port}`;
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...headers
  });

  response.end(JSON.stringify(body));
}

test("Directus client preserves the issued cookie without refreshing", async (t) => {
  const requests = [];
  let loginBody;

  const baseUrl = await startServer(t, (request, response) => {
    requests.push({
      path: request.url,
      cookie: request.headers.cookie
    });

    if (request.url === "/auth/login") {
      let text = "";

      request.on("data", (chunk) => {
        text += chunk;
      });

      request.on("end", () => {
        loginBody = JSON.parse(text);

        sendJson(response, 200, { data: { expires: 60000 } }, {
          "Set-Cookie":
            "directus_session_token=synthetic-session; Path=/; HttpOnly"
        });
      });

      return;
    }

    sendJson(response, 200, {
      data: { id: 1, title: "Fixture", content: "Synthetic content" }
    });
  });

  const client = createDirectusClient({ baseUrl });
  const session = await client.login({
    email: "target@example.com",
    password: "synthetic-test-password"
  });

  await session.readDocument();
  await session.readDocument();
  await client.readAnonymousDocument();

  assert.deepEqual(loginBody, {
    email: "target@example.com",
    password: "synthetic-test-password",
    mode: "session"
  });

  assert.equal(requests.length, 4);
  assert.equal(requests[0].cookie, undefined);
  assert.equal(
    requests[1].cookie,
    "directus_session_token=synthetic-session"
  );
  assert.equal(requests[2].cookie, requests[1].cookie);
  assert.equal(requests[3].cookie, undefined);

  assert.equal(
    requests[1].path,
    "/items/revokx_documents/1?fields=id,title,content"
  );

  assert.equal(JSON.stringify(session), "{}");
});

test("Directus client rejects unsuccessful login and missing session cookies", async (t) => {
  const baseUrl = await startServer(t, (request, response) => {
    request.resume();

    if (request.headers["content-type"] !== "application/json") {
      sendJson(response, 415, {});
      return;
    }

    sendJson(response, 200, { data: {} });
  });

  const client = createDirectusClient({ baseUrl });

  await assert.rejects(
    client.login({
      email: "target@example.com",
      password: "synthetic-test-password"
    }),
    /DIRECTUS_SESSION_COOKIE_MISSING/
  );

  const rejectedUrl = await startServer(t, (request, response) => {
    request.resume();
    sendJson(response, 401, {
      errors: [{ extensions: { code: "INVALID_CREDENTIALS" } }]
    });
  });

  await assert.rejects(
    createDirectusClient({ baseUrl: rejectedUrl }).login({
      email: "target@example.com",
      password: "synthetic-test-password"
    }),
    /DIRECTUS_LOGIN_REJECTED/
  );
});

test("Directus client does not follow redirects", async (t) => {
  let destinationRequests = 0;

  const baseUrl = await startServer(t, (request, response) => {
    if (request.url === "/destination") {
      destinationRequests++;
      sendJson(response, 200, {});
      return;
    }

    response.writeHead(302, { Location: "/destination" });
    response.end();
  });

  await assert.rejects(
    createDirectusClient({ baseUrl }).readAnonymousDocument(),
    /DIRECTUS_REQUEST_FAILED/
  );

  assert.equal(destinationRequests, 0);
});

test("Directus client times out while waiting for a response body", async (t) => {
  const baseUrl = await startServer(t, (request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write('{"data":');
  });

  const client = createDirectusClient({
    baseUrl,
    requestTimeoutMs: 100
  });

  await assert.rejects(
    client.readAnonymousDocument(),
    /DIRECTUS_REQUEST_FAILED/
  );
});

test("Directus client preserves error status and treats non-JSON as ambiguous", async (t) => {
  const baseUrl = await startServer(t, (request, response) => {
    response.writeHead(503, { "Content-Type": "text/html" });
    response.end("<html>Unavailable</html>");
  });

  const result = await createDirectusClient({
    baseUrl
  }).readAnonymousDocument();

  assert.deepEqual(result, {
    status: 503,
    body: null
  });
});

test("Directus client rejects non-loopback destinations and invalid settings", () => {
  for (const baseUrl of [
    "https://example.com",
    "http://192.168.1.10:8055",
    "http://user:password@127.0.0.1:8055",
    "http://127.0.0.1:8055/admin"
  ]) {
    assert.throws(
      () => createDirectusClient({ baseUrl }),
      /loopback HTTP origin/
    );
  }

  for (const requestTimeoutMs of [0, -1, NaN, 1.5, 60001]) {
    assert.throws(
      () => createDirectusClient({ requestTimeoutMs }),
      /Invalid request timeout/
    );
  }
});