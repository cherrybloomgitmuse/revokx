function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasOnlyKey(value, key) {
  return isObject(value) &&
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, key);
}
function restrictsToDocumentOne(filter) {
  let rule = filter;
  if (hasOnlyKey(rule, "_and")) {
    if (!Array.isArray(rule._and) || rule._and.length !== 1) return false;
    rule = rule._and[0];
  }
  return hasOnlyKey(rule, "id") &&
    hasOnlyKey(rule.id, "_eq") &&
    [1, "1"].includes(rule.id._eq);
}
function isEmptyRule(value) {
  return value === null || (isObject(value) && Object.keys(value).length === 0);
}
function conflict(reason) {
  return { status: "CONFLICT", reason };
}
export function validateAccessSnapshot(snapshot) {
  if (
    snapshot?.status !== "SNAPSHOT_COLLECTED" ||
    !["roles", "users", "policies", "permissions"].every(
      (key) => Array.isArray(snapshot[key]) && snapshot[key].every(isObject)
    )
  ) {
    return { status: "INCONCLUSIVE", reason: "INVALID_ACCESS_SNAPSHOT" };
  }
  const { roles, users, policies, permissions } = snapshot;
  if (roles.length !== 1 || roles[0].name !== "REVOKX Reader") {
    return conflict("READER_ROLE_MISSING_OR_AMBIGUOUS");
  }
  const role = roles[0];
  if (typeof role.id !== "string" || !role.id || role.parent !== null) {
    return conflict("READER_ROLE_CONFIGURATION_MISMATCH");
  }
  if (policies.length !== 1 || policies[0].name !== "REVOKX Document Reader") {
    return conflict("READER_POLICY_MISSING_OR_AMBIGUOUS");
  }
  const policy = policies[0];
  if (
    typeof policy.id !== "string" ||
    !policy.id ||
    policy.admin_access !== false ||
    policy.app_access !== false ||
    policy.enforce_tfa !== false ||
    ![null, ""].includes(policy.ip_access)
  ) {
    return conflict("READER_POLICY_CONFIGURATION_MISMATCH");
  }
  if (
    !Array.isArray(role.policies) ||
    role.policies.length !== 1 ||
    role.policies[0]?.policy !== policy.id
  ) {
    return conflict("ROLE_POLICY_ASSIGNMENT_MISMATCH");
  }
  const expectedEmails = ["target@example.com", "control@example.com"];
  if (
    users.length !== 2 ||
    !expectedEmails.every(
      (email) => users.filter((user) => user.email === email).length === 1
    ) ||
    users.some((user) => typeof user.id !== "string" || !user.id) ||
    new Set(users.map((user) => user.id)).size !== 2
  ) {
    return conflict("LAB_USERS_MISSING_OR_AMBIGUOUS");
  }
  if (users.some((user) =>
    user.status !== "active" ||
    user.provider !== "default" ||
    user.role !== role.id ||
    !Array.isArray(user.policies) ||
    user.policies.length !== 0
  )) {
    return conflict("LAB_USER_CONFIGURATION_MISMATCH");
  }
  if (permissions.length !== 1) {
    return conflict("PERMISSION_SET_MISMATCH");
  }
  const permission = permissions[0];
  if (
    permission.policy !== policy.id ||
    permission.collection !== "revokx_documents" ||
    permission.action !== "read"
  ) {
    return conflict("READ_PERMISSION_MISMATCH");
  }
  const expectedFields = ["id", "title", "content"];
  if (
    !Array.isArray(permission.fields) ||
    permission.fields.length !== expectedFields.length ||
    !expectedFields.every((field) => permission.fields.includes(field))
  ) {
    return conflict("READ_FIELDS_MISMATCH");
  }
  if (!restrictsToDocumentOne(permission.permissions)) {
    return conflict("DOCUMENT_FILTER_MISMATCH");
  }
  if (!isEmptyRule(permission.validation) || !isEmptyRule(permission.presets)) {
    return conflict("UNEXPECTED_PERMISSION_RULES");
  }
  return {
    status: "MATCH",
    reason: "ACCESS_SNAPSHOT_MATCHES_LAB_CONFIGURATION"
  };
}