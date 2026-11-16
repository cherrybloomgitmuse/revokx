import { createDirectusClient } from "./client.js";
import { inspectDocumentFixture } from "./inspect-document.js";
let password = process.env.REVOKX_ADMIN_PASSWORD;
delete process.env.REVOKX_ADMIN_PASSWORD;
try {
  if (!password) {
    throw new Error("ADMIN_PASSWORD_REQUIRED");
  }
  const client = createDirectusClient({ requestTimeoutMs: 5000 });
  const admin = await client.login({
    email: "admin@example.com",
    password
  });
  password = undefined;
  const identity = await admin.readIdentity();
  if (
    identity.status !== 200 ||
    identity.body?.data?.email !== "admin@example.com" ||
    identity.body?.data?.status !== "active"
  ) {
    throw new Error("ADMIN_IDENTITY_NOT_VERIFIED");
  }
  const result = await inspectDocumentFixture(admin);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "MATCH" ? 0 : 2;
} catch {
  console.error("LIVE_INSPECTION_FAILED: check server availability and admin credentials.");
  process.exitCode = 2;
} finally {
  password = undefined;
}
