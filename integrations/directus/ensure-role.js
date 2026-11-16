import { ensureReaderPolicy } from "./ensure-policy.js";
export async function ensureReaderRole(admin, dependencies = {}) {
  const ensurePolicy = dependencies.ensurePolicy ?? ensureReaderPolicy;
  const attempted = [];
  let stage = "policy-setup";
  let policySetup;
  try {
    policySetup = await ensurePolicy(admin);
    if (policySetup.status !== "MATCH") {
      return {
        status: policySetup.status,
        reason: "ROLE_POLICY_PREREQUISITE_FAILED",
        policySetup,
        attempted
      };
    }
    const policyId = policySetup.policyId;
    if (typeof policyId !== "string" || !policyId) {
      throw new Error("POLICY_ID_MISSING");
    }
    async function inspectRole() {
      const response = await admin.readSetupResource("roles", {
        fields: "id,name,parent,policies.policy",
        filter: JSON.stringify({ name: { _eq: "REVOKX Reader" } }),
        limit: "2"
      });
      if (
        response?.status !== 200 ||
        !Array.isArray(response.body?.data) ||
        Object.hasOwn(response.body, "errors")
      ) {
        throw new Error("ROLE_READ_FAILED");
      }
      const roles = response.body.data;
      if (roles.length === 0) {
        return { status: "MISSING", reason: "READER_ROLE_MISSING" };
      }
      if (roles.length !== 1) {
        return { status: "CONFLICT", reason: "DUPLICATE_READER_ROLE" };
      }
      const role = roles[0];
      if (
        !role ||
        typeof role.id !== "string" ||
        !role.id ||
        role.name !== "REVOKX Reader" ||
        role.parent !== null ||
        !Array.isArray(role.policies) ||
        role.policies.length !== 1 ||
        role.policies[0]?.policy !== policyId
      ) {
        return { status: "CONFLICT", reason: "READER_ROLE_MISMATCH" };
      }
      return {
        status: "MATCH",
        reason: "READER_ROLE_VERIFIED",
        roleId: role.id,
        policyId
      };
    }
    stage = "role-inspection";
    let inspection = await inspectRole();
    if (inspection.status === "MISSING") {
      stage = "create-role";
      attempted.push("role");
      const response = await admin.createSetupResource("roles", {
        name: "REVOKX Reader",
        parent: null,
        policies: [{ policy: policyId }]
      });
      if (
        ![200, 201].includes(response?.status) ||
        !response.body ||
        typeof response.body !== "object" ||
        Object.hasOwn(response.body, "errors")
      ) {
        throw new Error("ROLE_CREATE_NOT_ACKNOWLEDGED");
      }
      stage = "verify-role";
      inspection = await inspectRole();
    }
    if (inspection.status === "MISSING") {
      inspection = {
        status: "INCONCLUSIVE",
        reason: "CREATED_ROLE_NOT_OBSERVED"
      };
    }
    return { ...inspection, policySetup, attempted };
  } catch {
    return {
      status: "INCONCLUSIVE",
      reason: "ROLE_SETUP_FAILED",
      stage,
      policySetup,
      attempted
    };
  }
}