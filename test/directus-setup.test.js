import test from "node:test";
import assert from "node:assert/strict";
import { setupDirectusLab } from "../integrations/directus/setup.js";
import { fixtureDocument } from "../integrations/directus/inspect-document.js";
function fixture() {
  const calls = [];
  const credentials = Object.fromEntries(
    ["admin", "target", "control"].map((name) => [
      name,
      { email: `${name}@example.com`, password: `synthetic-${name}-password` }
    ])
  );
  const allowed = () => ({
    status: 200,
    body: { data: { ...fixtureDocument } }
  });
  const dependencies = {
    client: {
      async login(credential) {
        calls.push(credential.email);
        return {
          async readIdentity() {
            return {
              status: 200,
              body: { data: { email: "admin@example.com", status: "active" } }
            };
          },
          async readDocument() { return allowed(); }
        };
      },
      async readAnonymousDocument() {
        return {
          status: 403,
          body: { errors: [{ extensions: { code: "FORBIDDEN" } }] }
        };
      }
    },
    async ensureDocument() {
      calls.push("document");
      return { status: "MATCH", attempted: [] };
    },
    async ensureUsers() {
      calls.push("users");
      return { status: "MATCH", attempted: [] };
    }
  };
  return { calls, credentials, dependencies, allowed };
}
test("combined setup verifies all stages and actual baseline content", async () => {
  const lab = fixture();
  const before = structuredClone(lab.credentials);
  const result = await setupDirectusLab(lab.credentials, lab.dependencies);
  assert.equal(result.status, "MATCH");
  assert.equal(result.accessVerified, true);
  assert.deepEqual(result.access, {
    target: "allowed",
    control: "allowed",
    anonymous: "denied"
  });
  assert.deepEqual(lab.calls, [
    "admin@example.com", "document", "users",
    "target@example.com", "control@example.com"
  ]);
  assert.deepEqual(lab.credentials, before);
  assert.equal(JSON.stringify(result).includes("synthetic-admin-password"), false);
});
test("invalid credentials stop before login or fixture changes", async () => {
  const lab = fixture();
  lab.credentials.control.password = lab.credentials.target.password;
  const result = await setupDirectusLab(lab.credentials, lab.dependencies);
  assert.equal(result.reason, "INVALID_SETUP_CREDENTIALS");
  assert.deepEqual(lab.calls, []);
});
test("document conflict prevents user setup and baseline requests", async () => {
  const lab = fixture();
  lab.dependencies.ensureDocument = async () => ({
    status: "CONFLICT",
    reason: "DOCUMENT_CONTENT_MISMATCH"
  });
  const result = await setupDirectusLab(lab.credentials, lab.dependencies);
  assert.equal(result.status, "CONFLICT");
  assert.deepEqual(lab.calls, ["admin@example.com"]);
});
test("user setup failure retains document setup progress", async () => {
  const lab = fixture();
  lab.dependencies.ensureUsers = async () => ({
    status: "INCONCLUSIVE",
    attempted: ["target"]
  });
  const result = await setupDirectusLab(lab.credentials, lab.dependencies);
  assert.equal(result.accessVerified, false);
  assert.equal(result.results.document.status, "MATCH");
  assert.deepEqual(result.results.users.attempted, ["target"]);
  assert.equal(lab.calls.includes("target@example.com"), false);
});
test("anonymous protected content prevents successful setup verification", async () => {
  const lab = fixture();
  lab.dependencies.client.readAnonymousDocument = async () => lab.allowed();
  const result = await setupDirectusLab(lab.credentials, lab.dependencies);
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.access.anonymous, "allowed");
  assert.equal(result.accessVerified, false);
});
test("target login failure is reported without exposing the password", async () => {
  const lab = fixture();
  const login = lab.dependencies.client.login;
  lab.dependencies.client.login = async (credential) => {
    if (credential.email === "target@example.com") {
      throw new Error(credential.password);
    }
    return login(credential);
  };
  const result = await setupDirectusLab(lab.credentials, lab.dependencies);
  assert.equal(result.stage, "target-login");
  assert.equal(result.accessVerified, false);
  assert.equal(JSON.stringify(result).includes(lab.credentials.target.password), false);
});