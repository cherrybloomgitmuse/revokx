import { createDirectusClient } from "./client.js";
import { validateAccessSnapshot } from "./validate-access.js";
let password = process.env.REVOKX_ADMIN_PASSWORD;
delete process.env.REVOKX_ADMIN_PASSWORD;
let stage = "login";
try {
  if (!password) throw new Error("PASSWORD_REQUIRED");
  const client = createDirectusClient({ requestTimeoutMs: 5000 });
  const admin = await client.login({
    email: "admin@example.com",
    password
  });
  password = undefined;
  async function read(resource, fields, filter) {
    stage = resource;
    const response = await admin.readSetupResource(resource, {
      fields,
      filter: JSON.stringify(filter),
      limit: "100"
    });
    if (
      response.status !== 200 ||
      !Array.isArray(response.body?.data) ||
      Object.hasOwn(response.body, "errors") ||
      response.body.data.length >= 100
    ) {
      throw new Error("INCOMPLETE_OR_UNEXPECTED_RESPONSE");
    }
    return response.body.data;
  }
  const roles = await read(
    "roles",
    "id,name,parent,policies.policy",
    { name: { _eq: "REVOKX Reader" } }
  );
  const users = await read(
    "users",
    "id,email,status,provider,role,policies.policy",
    { email: { _in: ["target@example.com", "control@example.com"] } }
  );
  const policies = await read(
    "policies",
    "id,name,admin_access,app_access,ip_access,enforce_tfa",
    { name: { _starts_with: "REVOKX" } }
  );
  const policyIds = policies.map((policy) => policy.id);
  const permissions = await read(
    "permissions",
    "id,policy,collection,action,fields,permissions,validation,presets",
    {
      _or: [
        { collection: { _eq: "revokx_documents" } },
        ...(policyIds.length ? [{ policy: { _in: policyIds } }] : [])
      ]
    }
  );
  stage = "validation";
  const result = validateAccessSnapshot({
    status: "SNAPSHOT_COLLECTED",
    roles,
    users,
    policies,
    permissions
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "MATCH" ? 0 : 2;
} catch {
  console.log(JSON.stringify({
    status: "INCONCLUSIVE",
    reason: "ACCESS_INSPECTION_FAILED",
    stage
  }, null, 2));
  process.exitCode = 2;
} finally {
  password = undefined;
}