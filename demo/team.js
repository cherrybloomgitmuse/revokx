import { Router } from "express";
import { randomUUID } from "node:crypto";

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

  const file = {
    id: "project-notes",
    content: `Confidential lab fixture: ${randomUUID()}`
  };

  router.use((request, response, next) => {
    if (!request.session.userId) {
      return response.status(401).json({
        error: "AUTH_REQUIRED"
      });
    }

    next();
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