import { Router } from "express";
import {
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function createTeamRouter({ mode = "fixed" } = {}) {
  if (!["fixed", "vulnerable"].includes(mode)) {
    throw new Error(`Unsupported demo mode: ${mode}`);
  }

  const router = Router();

  const members = new Map([
    ["owner", "owner"],
    ["target", "member"],
    ["remaining", "member"]
  ]);

  // Store token hashes, not raw bearer tokens.
  const downloadLinks = new Map();

  const file = {
    id: "project-notes",
    content: `Confidential lab fixture: ${randomUUID()}`
  };

  // Bearer downloads intentionally do not require a session.
  router.get("/downloads/:token", (request, response) => {
    const token = request.params.token;

    if (!/^[a-f0-9]{64}$/.test(token)) {
      return response.status(404).json({
        error: "LINK_NOT_FOUND"
      });
    }

    const link = downloadLinks.get(hashToken(token));

    if (!link) {
      return response.status(404).json({
        error: "LINK_NOT_FOUND"
      });
    }

    if (
      mode === "fixed" &&
      !members.has(link.issuedTo)
    ) {
      return response.status(403).json({
        error: "TEAM_ACCESS_DENIED"
      });
    }

    // Vulnerable mode intentionally trusts the old grant.
    response.json({ file });
  });

  router.use((request, response, next) => {
    if (!request.session.userId) {
      return response.status(401).json({
        error: "AUTH_REQUIRED"
      });
    }

    next();
  });

  router.post("/download-links", (request, response) => {
    const csrfToken = request.session.csrfToken;

    if (
      typeof csrfToken !== "string" ||
      request.get("x-csrf-token") !== csrfToken
    ) {
      return response.status(403).json({
        error: "CSRF_INVALID"
      });
    }

    // Both modes prevent removed users from minting new links.
    if (!members.has(request.session.userId)) {
      return response.status(403).json({
        error: "TEAM_ACCESS_DENIED"
      });
    }

    const token = randomBytes(32).toString("hex");

    downloadLinks.set(hashToken(token), {
      issuedTo: request.session.userId
    });

    response.status(201).json({
      downloadPath: `/team/downloads/${token}`
    });
  });

  router.get("/members", (request, response) => {
    if (members.get(request.session.userId) !== "owner") {
      return response.status(403).json({
        error: "OWNER_REQUIRED"
      });
    }

    response.json({
      memberIds: [...members.keys()]
    });
  });

  router.get("/file", (request, response) => {
    const currentlyAllowed = members.has(request.session.userId);
    let allowed = currentlyAllowed;

    if (mode === "vulnerable") {
      // Intentional stale-permission bug.
      if (currentlyAllowed) {
        request.session.cachedTeamAccess = true;
      }

      allowed = request.session.cachedTeamAccess === true;
    }

    if (!allowed) {
      return response.status(403).json({
        error: "TEAM_ACCESS_DENIED"
      });
    }

    response.json({ file });
  });

  router.delete("/members/:userId", (request, response) => {
    if (
      request.get("x-csrf-token") !== request.session.csrfToken
    ) {
      return response.status(403).json({
        error: "CSRF_INVALID"
      });
    }

    if (members.get(request.session.userId) !== "owner") {
      return response.status(403).json({
        error: "OWNER_REQUIRED"
      });
    }

    const targetId = request.params.userId;

    if (targetId === "owner") {
      return response.status(409).json({
        error: "OWNER_REMOVAL_NOT_SUPPORTED"
      });
    }

    if (!members.has(targetId)) {
      return response.status(404).json({
        error: "MEMBER_NOT_FOUND"
      });
    }

    members.delete(targetId);

    response.json({
      removedUserId: targetId
    });
  });

  return router;
}