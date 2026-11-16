import test from "node:test";
import assert from "node:assert/strict";
import { ensureReaderPolicy } from "../integrations/directus/ensure-policy.js";
import { fixtureDocument } from "../integrations/directus/inspect-document.js";
function fakeLab() {
  const state = {
    policies: [],
    permissions: [],
    collections: [{ collection: "revokx_documents" }],
    documentFields: [
      {
        collection: "revokx_documents",
        field: "id",
        type: "integer",
        schema: { is_primary_key: true, has_auto_increment: true }
      },
      {
        collection: "revokx_documents",
        field: "title",
        type: "string",
        schema: {}
      },
      {
        collection: "revokx_documents",
        field: "content",
        type: "text",
        schema: {}
      }
    ],
    documents: [{ ...fixtureDocument }]
  };
  const writes = [];
  const admin = {
    async readSetupResource(resource) {
      return { status: 200, body: { data: structuredClone(state[resource]) } };
    },
    async createSetupResource(resource, body) {
      writes.push(resource);
      if (resource === "policies") {
        state.policies.push({
          ...structuredClone(body),
          id: "reader-policy",
          users: [],
          roles: []
        });
      } else if (resource === "permissions") {
        assert.equal(body.policy, "reader-policy");
        state.permissions.push({ ...structuredClone(body), id: 1 });
      } else {
        assert.fail("Unexpected write resource");
      }
      return { status: 200, body: { data: {} } };
    }
  };
  return { state, writes, admin };
}
test("policy setup creates restricted permissions and reuses them on rerun", async () => {
  const lab = fakeLab();
  const first = await ensureReaderPolicy(lab.admin);
  assert.equal(first.status, "MATCH");
  assert.deepEqual(lab.writes, ["policies", "permissions"]);
  assert.deepEqual(lab.state.permissions[0].permissions, { id: { _eq: 1 } });
  assert.deepEqual(lab.state.permissions[0].fields, ["id", "title", "content"]);
  assert.equal(lab.state.policies[0].admin_access, false);
  const second = await ensureReaderPolicy(lab.admin);
  assert.equal(second.status, "MATCH");
  assert.deepEqual(second.attempted, []);
  assert.equal(lab.writes.length, 2);
});
test("policy setup rejects elevated, broadened, or additional permissions", async () => {
  for (const change of [
    (s) => { s.policies[0].admin_access = true; },
    (s) => { s.permissions[0].permissions = null; },
    (s) => { s.permissions[0].fields = ["*"]; },
    (s) => { s.permissions[0].action = "update"; },
    (s) => { s.permissions.push({ ...s.permissions[0], id: 2 }); }
  ]) {
    const lab = fakeLab();
    await ensureReaderPolicy(lab.admin);
    change(lab.state);
    lab.writes.length = 0;
    const result = await ensureReaderPolicy(lab.admin);
    assert.equal(result.status, "CONFLICT");
    assert.deepEqual(lab.writes, []);
  }
});
test("policy setup does not grant missing permissions to an assigned policy", async () => {
  const lab = fakeLab();
  await ensureReaderPolicy(lab.admin);
  lab.state.permissions = [];
  lab.state.policies[0].roles = ["existing-assignment"];
  lab.writes.length = 0;
  const result = await ensureReaderPolicy(lab.admin);
  assert.equal(result.reason, "ASSIGNED_POLICY_WITHOUT_PERMISSION");
  assert.deepEqual(lab.writes, []);
});
test("policy setup stops when document fixture conflicts", async () => {
  const lab = fakeLab();
  lab.state.documents[0].content = "Different fixture";
  const result = await ensureReaderPolicy(lab.admin);
  assert.equal(result.status, "CONFLICT");
  assert.deepEqual(lab.writes, []);
});
test("policy inspection failure cannot trigger creation", async () => {
  const lab = fakeLab();
  const read = lab.admin.readSetupResource;
  lab.admin.readSetupResource = async (resource) => resource === "policies"
    ? { status: 403, body: { errors: [] } }
    : read(resource);
  const result = await ensureReaderPolicy(lab.admin);
  assert.equal(result.status, "INCONCLUSIVE");
  assert.deepEqual(lab.writes, []);
});
test("acknowledged policy creation without persisted state cannot pass", async () => {
  const lab = fakeLab();
  lab.admin.createSetupResource = async (resource) => {
    lab.writes.push(resource);
    return { status: 200, body: { data: {} } };
  };
  const result = await ensureReaderPolicy(lab.admin);
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.reason, "CREATED_POLICY_FIXTURE_NOT_OBSERVED");
  assert.deepEqual(lab.writes, ["policies"]);
});