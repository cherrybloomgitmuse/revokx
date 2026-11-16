import { isDeepStrictEqual } from "node:util";
import { inspectDocumentFixture } from "./inspect-document.js";
const policyName = "REVOKX Document Reader";
function policyPayload() {
  return {
    name: policyName,
    admin_access: false,
    app_access: false,
    enforce_tfa: false,
    ip_access: null
  };
}
function permissionPayload(policyId) {
  return {
    policy: policyId,
    collection: "revokx_documents",
    action: "read",
    fields: ["id", "title", "content"],
    permissions: { id: { _eq: 1 } },
    validation: null,
    presets: null
  };
}
function validPermission(actual, policyId) {
  if (!actual || typeof actual !== "object") return false;
  let filter = actual.permissions;
  if (
    filter && Object.keys(filter).length === 1 &&
    Array.isArray(filter._and) && filter._and.length === 1
  ) {
    filter = filter._and[0];
  }
  const validFilter = [1, "1"].some((value) =>
    isDeepStrictEqual(filter, { id: { _eq: value } })
  );
  return actual.policy === policyId &&
    actual.collection === "revokx_documents" &&
    actual.action === "read" &&
    Array.isArray(actual.fields) &&
    isDeepStrictEqual([...actual.fields].sort(), ["content", "id", "title"]) &&
    validFilter &&
    [actual.validation, actual.presets].every(
      (value) => value === null || isDeepStrictEqual(value, {})
    );
}
async function readList(admin, resource, fields, filter) {
  const response = await admin.readSetupResource(resource, {
    fields,
    filter: JSON.stringify(filter),
    limit: "100"
  });
  if (
    response?.status !== 200 ||
    !Array.isArray(response.body?.data) ||
    Object.hasOwn(response.body, "errors") ||
    response.body.data.length >= 100
  ) {
    throw new Error("UNVERIFIED_LIST");
  }
  return response.body.data;
}
async function inspectPolicy(admin) {
  const policies = await readList(
    admin,
    "policies",
    "id,name,admin_access,app_access,enforce_tfa,ip_access,users,roles",
    { name: { _eq: policyName } }
  );
  if (policies.length > 1) {
    return { status: "CONFLICT", reason: "DUPLICATE_READER_POLICY" };
  }
  const policy = policies[0];
  if (policy && (
    typeof policy.id !== "string" || !policy.id ||
    policy.name !== policyName ||
    policy.admin_access !== false ||
    policy.app_access !== false ||
    policy.enforce_tfa !== false ||
    ![null, ""].includes(policy.ip_access) ||
    !Array.isArray(policy.users) ||
    !Array.isArray(policy.roles)
  )) {
    return { status: "CONFLICT", reason: "READER_POLICY_MISMATCH" };
  }
  const permissions = await readList(
    admin,
    "permissions",
    "id,policy,collection,action,fields,permissions,validation,presets",
    {
      _or: [
        { collection: { _eq: "revokx_documents" } },
        ...(policy ? [{ policy: { _eq: policy.id } }] : [])
      ]
    }
  );
  if (!policy) {
    return permissions.length === 0
      ? { status: "MISSING", reason: "POLICY_MISSING" }
      : { status: "CONFLICT", reason: "EXISTING_DOCUMENT_PERMISSIONS" };
  }
  if (permissions.length === 0) {
    return policy.users.length || policy.roles.length
      ? { status: "CONFLICT", reason: "ASSIGNED_POLICY_WITHOUT_PERMISSION" }
      : { status: "MISSING", reason: "PERMISSION_MISSING", policyId: policy.id };
  }
  if (permissions.length !== 1 || !validPermission(permissions[0], policy.id)) {
    return { status: "CONFLICT", reason: "READER_PERMISSION_MISMATCH" };
  }
  return { status: "MATCH", reason: "READER_POLICY_VERIFIED", policyId: policy.id };
}
function requireAcknowledgement(response) {
  if (
    ![200, 201].includes(response?.status) ||
    !response.body ||
    typeof response.body !== "object" ||
    Object.hasOwn(response.body, "errors")
  ) {
    throw new Error("CREATE_NOT_ACKNOWLEDGED");
  }
}
export async function ensureReaderPolicy(admin) {
  const attempted = [];
  let stage = "document-inspection";
  try {
    const document = await inspectDocumentFixture(admin);
    if (document.status !== "MATCH") {
      return { ...document, stage, attempted };
    }
    stage = "policy-inspection";
    let inspection = await inspectPolicy(admin);
    if (inspection.status === "MISSING" && inspection.reason === "POLICY_MISSING") {
      stage = "create-policy";
      attempted.push("policy");
      requireAcknowledgement(
        await admin.createSetupResource("policies", policyPayload())
      );
      stage = "verify-policy";
      inspection = await inspectPolicy(admin);
    }
    if (inspection.status === "MISSING" && inspection.reason === "PERMISSION_MISSING") {
      stage = "create-permission";
      attempted.push("permission");
      requireAcknowledgement(
        await admin.createSetupResource("permissions", permissionPayload(inspection.policyId))
      );
      stage = "verify-permission";
      inspection = await inspectPolicy(admin);
    }
    if (inspection.status === "MISSING") {
      return {
        status: "INCONCLUSIVE",
        reason: "CREATED_POLICY_FIXTURE_NOT_OBSERVED",
        stage,
        attempted
      };
    }
    return { ...inspection, attempted };
  } catch {
    return {
      status: "INCONCLUSIVE",
      reason: "POLICY_SETUP_FAILED",
      stage,
      attempted
    };
  }
}