import test from "node:test";
import assert from "node:assert/strict";
import { ensureLabUsers } from "../integrations/directus/ensure-users.js";
function fakeLab() {
  const users = [];
  const writes = [];
  const credentials = {
    target: { email: "target@example.com", password: "synthetic-target-password" },
    control: { email: "control@example.com", password: "synthetic-control-password" }
  };
  const dependencies = {
    ensureRole: async () => ({
      status: "MATCH",
      roleId: "reader-role",
      attempted: []
    })
  };
  const admin = {
    async readSetupResource(resource, query) {
      assert.equal(resource, "users");
      assert.deepEqual(JSON.parse(query.filter), {
        email: { _in: ["target@example.com", "control@example.com"] }
      });
      assert.equal(query.limit, "3");
      return { status: 200, body: { data: structuredClone(users) } };
    },
    async createSetupResource(resource, body) {
      assert.equal(resource, "users");
      const name = body.email.split("@")[0];
      assert.equal(body.password, credentials[name].password);
      writes.push(body.email);
      users.push({
        id: `${name}-user`,
        email: body.email,
        status: body.status,
        provider: body.provider,
        role: body.role,
        token: body.token,
        policies: structuredClone(body.policies)
      });
      return { status: 200, body: { data: {} } };
    }
  };
  return { users, writes, credentials, dependencies, admin };
}
test("user setup creates both accounts and reuses them without password resets", async () => {
  const lab = fakeLab();
  const first = await ensureLabUsers(lab.admin, lab.credentials, lab.dependencies);
  assert.equal(first.status, "MATCH");
  assert.deepEqual(first.attempted, ["target", "control"]);
  assert.deepEqual(first.userIds, {
    target: "target-user",
    control: "control-user"
  });
  const second = await ensureLabUsers(lab.admin, lab.credentials, lab.dependencies);
  assert.equal(second.status, "MATCH");
  assert.deepEqual(second.attempted, []);
  assert.equal(lab.writes.length, 2);
  assert.equal(JSON.stringify(first).includes(lab.credentials.target.password), false);
});
test("user setup checks both existing accounts before any user writes", async () => {
  for (const change of [
    (user) => { user.status = "suspended"; },
    (user) => { user.role = "admin-role"; },
    (user) => { user.provider = "external"; },
    (user) => { user.policies = [{ policy: "extra-policy" }]; },
    (user) => { user.token = "synthetic-static-secret"; }
  ]) {
    const lab = fakeLab();
    await ensureLabUsers(lab.admin, lab.credentials, lab.dependencies);
    lab.users.shift();
    change(lab.users[0]);
    lab.writes.length = 0;
    const result = await ensureLabUsers(lab.admin, lab.credentials, lab.dependencies);
    assert.equal(result.status, "CONFLICT");
    assert.deepEqual(lab.writes, []);
    assert.equal(JSON.stringify(result).includes("synthetic-static-secret"), false);
  }
});
test("user setup creates only the missing account", async () => {
  const lab = fakeLab();
  await ensureLabUsers(lab.admin, lab.credentials, lab.dependencies);
  lab.users.pop();
  lab.writes.length = 0;
  const result = await ensureLabUsers(lab.admin, lab.credentials, lab.dependencies);
  assert.equal(result.status, "MATCH");
  assert.deepEqual(lab.writes, ["control@example.com"]);
});
test("invalid credentials stop before prerequisite setup", async () => {
  const lab = fakeLab();
  lab.credentials.control.password = lab.credentials.target.password;
  const result = await ensureLabUsers(lab.admin, lab.credentials, {
    ensureRole: () => assert.fail("Prerequisite must not run")
  });
  assert.equal(result.reason, "INVALID_LAB_USER_CREDENTIALS");
  assert.deepEqual(lab.writes, []);
});
test("failed user reads cannot trigger creation", async () => {
  const lab = fakeLab();
  lab.admin.readSetupResource = async () => ({
    status: 403,
    body: { errors: [] }
  });
  const result = await ensureLabUsers(lab.admin, lab.credentials, lab.dependencies);
  assert.equal(result.status, "INCONCLUSIVE");
  assert.deepEqual(lab.writes, []);
});
test("successful creation response without persisted user cannot pass", async () => {
  const lab = fakeLab();
  lab.admin.createSetupResource = async () => ({
    status: 200,
    body: { data: {} }
  });
  const result = await ensureLabUsers(lab.admin, lab.credentials, lab.dependencies);
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.stage, "verify-target");
});
test("lost creation response stops and rerun reuses the persisted account", async () => {
  const lab = fakeLab();
  const create = lab.admin.createSetupResource;
  lab.admin.createSetupResource = async (resource, body) => {
    const response = await create(resource, body);
    if (body.email === "target@example.com") {
      throw new Error(lab.credentials.target.password);
    }
    return response;
  };
  const first = await ensureLabUsers(lab.admin, lab.credentials, lab.dependencies);
  assert.equal(first.status, "INCONCLUSIVE");
  assert.equal(JSON.stringify(first).includes(lab.credentials.target.password), false);
  const second = await ensureLabUsers(lab.admin, lab.credentials, lab.dependencies);
  assert.equal(second.status, "MATCH");
  assert.deepEqual(lab.writes, ["target@example.com", "control@example.com"]);
});