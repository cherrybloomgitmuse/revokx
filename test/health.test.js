import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../demo/app.js";

test("GET /health returns the expected JSON response", async (t) => {
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");

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

  const port = server.address().port;

  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(3000)
  });

  const body = await response.json();

  assert.equal(response.status, 200);

  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/json\b/i
  );

  assert.deepEqual(body, {
    service: "revokx-demo",
    status: "ok"
  });
});