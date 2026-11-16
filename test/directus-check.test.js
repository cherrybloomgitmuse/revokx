import test from "node:test";
import assert from "node:assert/strict";
import { checkDirectusRevocation } from "../integrations/directus/check.js";
function fixture({
  leak = false,
  ignoreSuspension = false,
  blockControl = false,
  cleanupFails = false,
  lostAcknowledgement = false
} = {}) {
  let time = 0;
  const changes = [];
  const logins = [];
  const users = {
    admin: { id: "admin-id", email: "admin@example.com", status: "active", role: "admin-role" },
    target: { id: "target-id", email: "target@example.com", status: "active", role: "reader-role" },
    control: { id: "control-id", email: "control@example.com", status: "active", role: "reader-role" }
  };
  const document = {
    id: 1,
    title: "REVOKX synthetic project notes",
    content: "REVOKX-FIXTURE-001\nSynthetic automated test data"
  };
  const ok = (data) => ({ status: 200, body: { data: structuredClone(data) } });
  const denied = () => ({
    status: 403,
    body: { errors: [{ extensions: { code: "FORBIDDEN" } }] }
  });
  const admin = {
    readIdentity: async () => ok(users.admin),
    findUsersByEmail: async (email) =>
      ok(Object.values(users).filter((user) => user.email === email)),
    readUser: async (id) => ok(Object.values(users).find((user) => user.id === id)),
    readDocument: async () => ok(document),
    setUserStatus: async (id, status) => {
      assert.equal(id, users.target.id);
      changes.push(status);
      if (status === "active" && cleanupFails) throw new Error("Synthetic cleanup failure");
      if (status === "active" || !ignoreSuspension) users.target.status = status;
      if (status === "suspended" && lostAcknowledgement) throw new Error("Synthetic timeout");
      return ok({ ...users.target, status });
    }
  };
  const client = {
    readAnonymousDocument: async () => denied(),
    login: async ({ email }) => {
      const name = Object.keys(users).find((key) => users[key].email === email);
      logins.push(name);
      if (name === "admin") return admin;
      return {
        readDocument: async () => {
          const suspended = users.target.status === "suspended";
          if (name === "target" && suspended && !leak) return denied();
          if (name === "control" && suspended && blockControl) return denied();
          return ok(document);
        }
      };
    }
  };
  const options = {
    credentials: Object.fromEntries(Object.entries(users).map(([name, user]) => [
      name, { email: user.email, password: `synthetic-${name}-password` }
    ])),
    revocationWindowMs: 0,
    observationMs: 30,
    pollIntervalMs: 10
  };
  const dependencies = {
    client,
    clock: {
      now: () => time,
      sleep: async (milliseconds) => { time += milliseconds; }
    }
  };
  return { options, dependencies, users, changes, logins, document };
}
test("Directus check: fixed behaviour passes and restores the target", async () => {
  const lab = fixture();
  const report = await checkDirectusRevocation(lab.options, lab.dependencies);
  assert.equal(report.verdict, "PASS");
  assert.equal(report.baselineVerified, true);
  assert.equal(report.suspensionVerified, true);
  assert.deepEqual(report.cleanup, { attempted: true, restored: true });
  assert.deepEqual(lab.changes, ["suspended", "active"]);
  assert.deepEqual(lab.logins, ["admin", "target", "control"]);
  assert.equal(report.results.length, 2);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(lab.document.content), false);
  assert.equal(serialized.includes("synthetic-target-password"), false);
});
test("Directus check: preserved-session leak fails despite successful cleanup", async () => {
  const lab = fixture({ leak: true });
  const report = await checkDirectusRevocation(lab.options, lab.dependencies);
  assert.equal(report.verdict, "FAIL");
  assert.equal(report.reason, "PROTECTED_CONTENT_AFTER_SUSPENSION");
  assert.equal(report.cleanup.restored, true);
  assert.equal(lab.users.target.status, "active");
});
test("Directus check: successful PATCH without actual suspension cannot pass", async () => {
  const lab = fixture({ ignoreSuspension: true });
  const report = await checkDirectusRevocation(lab.options, lab.dependencies);
  assert.equal(report.verdict, "INCONCLUSIVE");
  assert.equal(report.stage, "suspension-verification");
  assert.equal(report.suspensionVerified, false);
  assert.equal(report.samples.length, 0);
});
test("Directus check: blocking the unaffected control fails", async () => {
  const lab = fixture({ blockControl: true });
  const report = await checkDirectusRevocation(lab.options, lab.dependencies);
  assert.equal(report.verdict, "FAIL");
  assert.equal(report.reason, "LEGITIMATE_ACCESS_DENIED");
});
test("Directus check: cleanup failure prevents PASS but preserves observed FAIL", async () => {
  for (const leak of [false, true]) {
    const lab = fixture({ leak, cleanupFails: true });
    const report = await checkDirectusRevocation(lab.options, lab.dependencies);
    assert.equal(report.verdict, leak ? "FAIL" : "INCONCLUSIVE");
    assert.equal(report.cleanup.restored, false);
  }
});
test("Directus check: a lost suspension response still triggers restoration", async () => {
  const lab = fixture({ lostAcknowledgement: true });
  const report = await checkDirectusRevocation(lab.options, lab.dependencies);
  assert.equal(report.verdict, "INCONCLUSIVE");
  assert.equal(report.stage, "suspension");
  assert.equal(report.cleanup.restored, true);
  assert.equal(lab.users.target.status, "active");
});
test("Directus check: invalid timing makes no login or mutation", async () => {
  const lab = fixture();
  const report = await checkDirectusRevocation(
    { ...lab.options, observationMs: 0 },
    lab.dependencies
  );
  assert.equal(report.reason, "INVALID_TIMING_CONFIGURATION");
  assert.deepEqual(lab.logins, []);
  assert.deepEqual(lab.changes, []);
});