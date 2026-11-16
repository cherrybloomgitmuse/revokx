import test from "node:test";
import assert from "node:assert/strict";
import { validateAccessSnapshot } from "../integrations/directus/validate-access.js";
function fixture() {
  return {
    status: "SNAPSHOT_COLLECTED",
    roles: [{
      id: "reader-role",
      name: "REVOKX Reader",
      parent: null,
      policies: [{ policy: "reader-policy" }]
    }],
    users: ["target", "control"].map((name) => ({
      id: `${name}-user`,
      email: `${name}@example.com`,
      status: "active",
      provider: "default",
      role: "reader-role",
      policies: []
    })),
    policies: [{
      id: "reader-policy",
      name: "REVOKX Document Reader",
      admin_access: false,
      app_access: false,
      ip_access: null,
      enforce_tfa: false
    }],
    permissions: [{
      id: 1,
      policy: "reader-policy",
      collection: "revokx_documents",
      action: "read",
      fields: ["id", "title", "content"],
      permissions: { _and: [{ id: { _eq: "1" } }] },
      validation: null,
      presets: null
    }]
  };
}
test("access validator accepts the observed configuration without mutation", () => {
  const snapshot = fixture();
  const before = structuredClone(snapshot);
  assert.equal(validateAccessSnapshot(snapshot).status, "MATCH");
  assert.deepEqual(snapshot, before);
});
test("access validator accepts direct ID equality and unordered field lists", () => {
  for (const value of [1, "1"]) {
    const snapshot = fixture();
    snapshot.permissions[0].permissions = { id: { _eq: value } };
    snapshot.permissions[0].fields = ["content", "id", "title"];
    assert.equal(validateAccessSnapshot(snapshot).status, "MATCH");
  }
});
test("access validator rejects absent, broadened, and incorrect item filters", () => {
  for (const filter of [
    null,
    {},
    { id: { _eq: 2 } },
    { id: { _in: [1, 2] } },
    { _or: [{ id: { _eq: 1 } }, { id: { _eq: 2 } }] },
    { _and: [{ id: { _eq: 1 } }], _or: [{}] }
  ]) {
    const snapshot = fixture();
    snapshot.permissions[0].permissions = filter;
    assert.equal(validateAccessSnapshot(snapshot).reason, "DOCUMENT_FILTER_MISMATCH");
  }
});
test("access validator rejects role inheritance and extra policy assignments", () => {
  for (const change of [
    (s) => { s.roles[0].parent = "another-role"; },
    (s) => { s.roles[0].policies.push({ policy: "extra-policy" }); },
    (s) => { s.users[0].policies.push({ policy: "extra-policy" }); },
    (s) => { s.users[0].role = "another-role"; }
  ]) {
    const snapshot = fixture();
    change(snapshot);
    assert.equal(validateAccessSnapshot(snapshot).status, "CONFLICT");
  }
});
test("access validator rejects elevated access and additional permissions", () => {
  for (const change of [
    (s) => { s.policies[0].admin_access = true; },
    (s) => { s.policies[0].app_access = true; },
    (s) => { s.permissions[0].action = "update"; },
    (s) => { s.permissions[0].fields = ["*"]; },
    (s) => { s.permissions.push({ ...s.permissions[0], policy: "public-policy" }); }
  ]) {
    const snapshot = fixture();
    change(snapshot);
    assert.equal(validateAccessSnapshot(snapshot).status, "CONFLICT");
  }
});
test("access validator rejects missing, duplicated, or inactive lab users", () => {
  for (const change of [
    (s) => { s.users.pop(); },
    (s) => { s.users[1] = { ...s.users[0] }; },
    (s) => { s.users[0].status = "suspended"; },
    (s) => { s.users[0].provider = "external"; }
  ]) {
    const snapshot = fixture();
    change(snapshot);
    assert.equal(validateAccessSnapshot(snapshot).status, "CONFLICT");
  }
});
test("access validator treats malformed snapshots as inconclusive", () => {
  for (const snapshot of [
    null,
    {},
    { ...fixture(), status: "INCONCLUSIVE" },
    { ...fixture(), roles: null },
    { ...fixture(), permissions: [null] }
  ]) {
    assert.equal(validateAccessSnapshot(snapshot).status, "INCONCLUSIVE");
  }
});