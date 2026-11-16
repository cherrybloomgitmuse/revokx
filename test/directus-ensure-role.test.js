import test from "node:test";
import assert from "node:assert/strict";
import { ensureReaderRole } from "../integrations/directus/ensure-role.js";
function fakeLab() {
  const roles = [];
  const writes = [];
  const dependencies = {
    ensurePolicy: async () => ({
      status: "MATCH",
      reason: "READER_POLICY_VERIFIED",
      policyId: "reader-policy",
      attempted: []
    })
  };
  const admin = {
    async readSetupResource(resource, query) {
      assert.equal(resource, "roles");
      assert.deepEqual(JSON.parse(query.filter), {
        name: { _eq: "REVOKX Reader" }
      });
      assert.equal(query.limit, "2");
      return { status: 200, body: { data: structuredClone(roles) } };
    },
    async createSetupResource(resource, body) {
      assert.equal(resource, "roles");
      writes.push(structuredClone(body));
      roles.push({ id: "reader-role", ...structuredClone(body) });
      return { status: 200, body: { data: {} } };
    }
  };
  return { roles, writes, admin, dependencies };
}
test("role setup creates the policy assignment and reuses it on rerun", async () => {
  const lab = fakeLab();
  const first = await ensureReaderRole(lab.admin, lab.dependencies);
  assert.equal(first.status, "MATCH");
  assert.equal(first.roleId, "reader-role");
  assert.deepEqual(lab.writes, [{
    name: "REVOKX Reader",
    parent: null,
    policies: [{ policy: "reader-policy" }]
  }]);
  const second = await ensureReaderRole(lab.admin, lab.dependencies);
  assert.equal(second.status, "MATCH");
  assert.deepEqual(second.attempted, []);
  assert.equal(lab.writes.length, 1);
});
test("role setup rejects inheritance, wrong policy, and extra assignments", async () => {
  for (const change of [
    (role) => { role.parent = "another-role"; },
    (role) => { role.policies = []; },
    (role) => { role.policies = [{ policy: "wrong-policy" }]; },
    (role) => { role.policies.push({ policy: "extra-policy" }); }
  ]) {
    const lab = fakeLab();
    await ensureReaderRole(lab.admin, lab.dependencies);
    change(lab.roles[0]);
    lab.writes.length = 0;
    const result = await ensureReaderRole(lab.admin, lab.dependencies);
    assert.equal(result.status, "CONFLICT");
    assert.deepEqual(lab.writes, []);
  }
});
test("role setup rejects duplicate roles without writing", async () => {
  const lab = fakeLab();
  await ensureReaderRole(lab.admin, lab.dependencies);
  lab.roles.push({ ...lab.roles[0], id: "duplicate-role" });
  lab.writes.length = 0;
  const result = await ensureReaderRole(lab.admin, lab.dependencies);
  assert.equal(result.reason, "DUPLICATE_READER_ROLE");
  assert.deepEqual(lab.writes, []);
});
test("role setup stops when policy verification fails", async () => {
  const result = await ensureReaderRole({
    readSetupResource() { assert.fail("Role read must not run"); },
    createSetupResource() { assert.fail("Role write must not run"); }
  }, {
    ensurePolicy: async () => ({
      status: "CONFLICT",
      reason: "READER_PERMISSION_MISMATCH",
      attempted: []
    })
  });
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.reason, "ROLE_POLICY_PREREQUISITE_FAILED");
});
test("failed role reads cannot trigger creation", async () => {
  const lab = fakeLab();
  lab.admin.readSetupResource = async () => ({
    status: 403,
    body: { errors: [] }
  });
  const result = await ensureReaderRole(lab.admin, lab.dependencies);
  assert.equal(result.status, "INCONCLUSIVE");
  assert.deepEqual(lab.writes, []);
});
test("successful creation response without stored assignment cannot pass", async () => {
  const lab = fakeLab();
  lab.admin.createSetupResource = async () => ({
    status: 200,
    body: { data: {} }
  });
  const result = await ensureReaderRole(lab.admin, lab.dependencies);
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.reason, "CREATED_ROLE_NOT_OBSERVED");
});