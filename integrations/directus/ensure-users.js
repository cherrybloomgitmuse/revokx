import { ensureReaderRole } from "./ensure-role.js";
const accounts = ["target", "control"];
function validCredentials(credentials) {
  return accounts.every((name) =>
    credentials?.[name]?.email === `${name}@example.com` &&
    typeof credentials[name].password === "string" &&
    credentials[name].password.length > 0
  ) && credentials.target.password !== credentials.control.password;
}
function usersMatchConfiguration(users, roleId) {
  return users.length <= 2 &&
    users.every((user) =>
      user !== null &&
      typeof user === "object" &&
      typeof user.id === "string" &&
      user.id.length > 0 &&
      accounts.some((name) => user.email === `${name}@example.com`) &&
      user.status === "active" &&
      user.provider === "default" &&
      user.role === roleId &&
      user.token === null &&
      Array.isArray(user.policies) &&
      user.policies.length === 0
    ) &&
    new Set(users.map((user) => user.email)).size === users.length &&
    new Set(users.map((user) => user.id)).size === users.length;
}
export async function ensureLabUsers(admin, credentials, dependencies = {}) {
  const attempted = [];
  if (!validCredentials(credentials)) {
    return {
      status: "INCONCLUSIVE",
      reason: "INVALID_LAB_USER_CREDENTIALS",
      attempted
    };
  }
  const ensureRole = dependencies.ensureRole ?? ensureReaderRole;
  let stage = "role-setup";
  let roleSetup;
  try {
    roleSetup = await ensureRole(admin);
    if (roleSetup.status !== "MATCH") {
      return {
        status: roleSetup.status,
        reason: "USER_ROLE_PREREQUISITE_FAILED",
        roleSetup,
        attempted
      };
    }
    const roleId = roleSetup.roleId;
    if (typeof roleId !== "string" || !roleId) {
      throw new Error("ROLE_ID_MISSING");
    }
    async function readUsers() {
      const response = await admin.readSetupResource("users", {
        fields: "id,email,status,provider,role,token,policies.policy",
        filter: JSON.stringify({
          email: { _in: accounts.map((name) => `${name}@example.com`) }
        }),
        limit: "3"
      });
      if (
        response?.status !== 200 ||
        !Array.isArray(response.body?.data) ||
        Object.hasOwn(response.body, "errors")
      ) {
        throw new Error("USER_READ_FAILED");
      }
      return response.body.data;
    }
    stage = "user-inspection";
    let users = await readUsers();
    if (!usersMatchConfiguration(users, roleId)) {
      return {
        status: "CONFLICT",
        reason: "LAB_USER_CONFIGURATION_MISMATCH",
        roleSetup,
        attempted
      };
    }
    for (const name of accounts) {
      const email = `${name}@example.com`;
      if (users.some((user) => user.email === email)) continue;
      stage = `create-${name}`;
      attempted.push(name);
      const response = await admin.createSetupResource("users", {
        email,
        password: credentials[name].password,
        first_name: `REVOKX ${name === "target" ? "Target" : "Control"}`,
        status: "active",
        provider: "default",
        role: roleId,
        token: null,
        policies: [],
        email_notifications: false
      });
      if (
        ![200, 201].includes(response?.status) ||
        !response.body ||
        typeof response.body !== "object" ||
        Object.hasOwn(response.body, "errors")
      ) {
        throw new Error("USER_CREATE_NOT_ACKNOWLEDGED");
      }
      stage = `verify-${name}`;
      users = await readUsers();
      if (
        !usersMatchConfiguration(users, roleId) ||
        !users.some((user) => user.email === email)
      ) {
        throw new Error("CREATED_USER_NOT_VERIFIED");
      }
    }
    stage = "final-user-verification";
    users = await readUsers();
    if (users.length !== 2 || !usersMatchConfiguration(users, roleId)) {
      throw new Error("FINAL_USERS_NOT_VERIFIED");
    }
    return {
      status: "MATCH",
      reason: "LAB_USER_CONFIGURATION_VERIFIED",
      userIds: Object.fromEntries(accounts.map((name) => [
        name,
        users.find((user) => user.email === `${name}@example.com`).id
      ])),
      roleSetup,
      attempted
    };
  } catch {
    return {
      status: "INCONCLUSIVE",
      reason: "USER_SETUP_FAILED",
      stage,
      roleSetup,
      attempted
    };
  }
}