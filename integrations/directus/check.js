import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { observeAccess } from "../../src/observe.js";
import { createDirectusClient } from "./client.js";
import { classifyDocumentResponse } from "./classify.js";
const realClock = {
  now: () => performance.now(),
  sleep: (milliseconds) => delay(milliseconds)
};
export async function checkDirectusRevocation(options, dependencies = {}) {
  const timing = {
    revocationWindowMs: options?.revocationWindowMs ?? 0,
    observationMs: options?.observationMs ?? 2000,
    pollIntervalMs: options?.pollIntervalMs ?? 100,
    requestTimeoutMs: options?.requestTimeoutMs ?? 3000
  };
  if (
    !Number.isFinite(timing.revocationWindowMs) ||
    timing.revocationWindowMs < 0 ||
    !Number.isFinite(timing.observationMs) ||
    timing.observationMs <= timing.revocationWindowMs ||
    !Number.isFinite(timing.pollIntervalMs) ||
    timing.pollIntervalMs <= 0 ||
    !Number.isInteger(timing.requestTimeoutMs) ||
    timing.requestTimeoutMs < 1 ||
    timing.requestTimeoutMs > 60000
  ) {
    return { verdict: "INCONCLUSIVE", reason: "INVALID_TIMING_CONFIGURATION" };
  }
  const credentials = options?.credentials;
  const expectedEmails = {
    admin: "admin@example.com",
    target: "target@example.com",
    control: "control@example.com"
  };
  if (!Object.entries(expectedEmails).every(([name, email]) =>
    credentials?.[name]?.email === email &&
    typeof credentials[name].password === "string" &&
    credentials[name].password.length > 0
  )) {
    return { verdict: "INCONCLUSIVE", reason: "INVALID_LAB_CREDENTIALS" };
  }
  const clock = dependencies.clock ?? realClock;
  let client;
  try {
    client = dependencies.client ?? createDirectusClient({
      baseUrl: options.baseUrl,
      requestTimeoutMs: timing.requestTimeoutMs
    });
  } catch {
    return { verdict: "INCONCLUSIVE", reason: "INVALID_CLIENT_CONFIGURATION" };
  }
  const report = {
    verdict: "INCONCLUSIVE",
    reason: "EXPERIMENT_NOT_COMPLETED",
    event: "ACCOUNT_SUSPENSION",
    resource: { collection: "revokx_documents", id: 1 },
    timingReference: "CLIENT_VALIDATED_SUSPENSION_RESPONSE",
    timing,
    baselineVerified: false,
    suspensionVerified: false,
    cleanup: { attempted: false, restored: null },
    results: [],
    samples: []
  };
  let stage = "login";
  let admin;
  let targetUser;
  let mutationAttempted = false;
  function requireCondition(condition) {
    if (!condition) throw new Error("VERIFICATION_FAILED");
  }
  async function findUser(email) {
    const result = await admin.findUsersByEmail(email);
    requireCondition(
      result.status === 200 &&
      Array.isArray(result.body?.data) &&
      result.body.data.length === 1
    );
    const user = result.body.data[0];
    requireCondition(
      typeof user.id === "string" &&
      user.email === email &&
      user.status === "active" &&
      typeof user.role === "string"
    );
    return user;
  }
  function verifyUserResponse(result, user, status) {
    requireCondition(
      result.status === 200 &&
      result.body?.data?.id === user.id &&
      result.body.data.email === user.email &&
      result.body.data.status === status &&
      result.body.data.role === user.role
    );
  }
  try {
    admin = await client.login(credentials.admin);
    stage = "fixture-verification";
    const identity = await admin.readIdentity();
    requireCondition(
      identity.status === 200 &&
      typeof identity.body?.data?.id === "string" &&
      typeof identity.body.data.role === "string" &&
      identity.body.data.email === expectedEmails.admin &&
      identity.body.data.status === "active"
    );
    targetUser = await findUser(expectedEmails.target);
    const controlUser = await findUser(expectedEmails.control);
    requireCondition(
      new Set([identity.body.data.id, targetUser.id, controlUser.id]).size === 3 &&
      targetUser.role !== identity.body.data.role &&
      controlUser.role !== identity.body.data.role
    );
    const target = await client.login(credentials.target);
    const control = await client.login(credentials.control);
    stage = "baseline";
    const ownerResponse = await admin.readDocument(1);
    const document = ownerResponse.body?.data;
    requireCondition(
      ownerResponse.status === 200 &&
      document?.id === 1 &&
      document.title === "REVOKX synthetic project notes" &&
      typeof document.content === "string" &&
      document.content.startsWith("REVOKX-FIXTURE-001\n")
    );
    for (const session of [target, control]) {
      requireCondition(
        classifyDocumentResponse(await session.readDocument(1), document) === "allowed"
      );
    }
    requireCondition(
      classifyDocumentResponse(await client.readAnonymousDocument(1), document) === "denied"
    );
    report.baselineVerified = true;
    stage = "suspension";
    mutationAttempted = true;
    const update = await admin.setUserStatus(targetUser.id, "suspended");
    verifyUserResponse(update, targetUser, "suspended");
    const referenceMs = clock.now();
    stage = "suspension-verification";
    verifyUserResponse(await admin.readUser(targetUser.id), targetUser, "suspended");
    verifyUserResponse(await admin.readUser(controlUser.id), controlUser, "active");
    report.suspensionVerified = true;
    stage = "observation";
    const observation = await observeAccess({
      referenceMs,
      revocationWindowMs: timing.revocationWindowMs,
      observationMs: timing.observationMs,
      pollIntervalMs: timing.pollIntervalMs,
      paths: [
        {
          id: "target-document-session",
          expected: "denied",
          probe: async () =>
            classifyDocumentResponse(await target.readDocument(1), document)
        },
        {
          id: "control-document-session",
          expected: "allowed",
          probe: async () =>
            classifyDocumentResponse(await control.readDocument(1), document)
        }
      ]
    }, clock);
    report.verdict = observation.verdict;
    report.results = observation.results;
    report.samples = observation.samples;
    const targetFailed = observation.results.some(
      (result) => result.pathId === "target-document-session" && result.verdict === "FAIL"
    );
    report.reason = targetFailed
      ? "PROTECTED_CONTENT_AFTER_SUSPENSION"
      : observation.verdict === "FAIL"
        ? "LEGITIMATE_ACCESS_DENIED"
        : observation.verdict === "PASS"
          ? "OBSERVED_POLICY_SATISFIED"
          : "INCOMPLETE_OR_UNEXPECTED_OBSERVATIONS";
  } catch {
    report.verdict = "INCONCLUSIVE";
    report.reason = "REQUEST_OR_VERIFICATION_FAILED";
    report.stage = stage;
  } finally {
    if (mutationAttempted) {
      report.cleanup.attempted = true;
      report.cleanup.restored = false;
      try {
        const update = await admin.setUserStatus(targetUser.id, "active");
        verifyUserResponse(update, targetUser, "active");
        verifyUserResponse(await admin.readUser(targetUser.id), targetUser, "active");
        report.cleanup.restored = true;
      } catch {
        if (report.verdict === "PASS") {
          report.verdict = "INCONCLUSIVE";
          report.reason = "CLEANUP_FAILED";
        }
      }
    }
  }
  return report;
}