import { Router } from "express";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

function createUsers() {
  const accounts = [
    ["owner", "lab-owner-only"],
    ["target", "lab-target-only"],
    ["remaining", "lab-remaining-only"]
  ];

  return new Map(
    accounts.map(([id, password]) => {
      const salt = randomBytes(16);
      const passwordHash = scryptSync(password, salt, 64);

      return [id, { id, salt, passwordHash }];
    })
  );
}

export function createAuthRouter() {
  const router = Router();
  const users = createUsers();

  router.post("/login", (request, response, next) => {
    if (!request.is("application/json")) {
      return response.status(415).json({
        error: "JSON_REQUIRED"
      });
    }

    const { username, password } = request.body ?? {};

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      username.length > 100 ||
      password.length > 200
    ) {
      return response.status(400).json({
        error: "INVALID_INPUT"
      });
    }

    const user = users.get(username);

    // Perform the same password-hashing work for unknown users.
    const comparisonUser = user ?? users.get("owner");
    const candidateHash = scryptSync(
      password,
      comparisonUser.salt,
      64
    );

    const passwordMatches = timingSafeEqual(
      candidateHash,
      comparisonUser.passwordHash
    );

    if (!user || !passwordMatches) {
      return response.status(401).json({
        error: "INVALID_CREDENTIALS"
      });
    }

    request.session.regenerate((error) => {
      if (error) {
        return next(error);
      }

      request.session.userId = user.id;
      request.session.csrfToken = randomBytes(32).toString("hex");

      request.session.save((saveError) => {
        if (saveError) {
          return next(saveError);
        }

        response.json({
          user: { id: user.id },
          csrfToken: request.session.csrfToken
        });
      });
    });
  });

  router.use((request, response, next) => {
    const user = users.get(request.session.userId);

    if (!user) {
      return response.status(401).json({
        error: "AUTH_REQUIRED"
      });
    }

    request.user = user;
    next();
  });

  router.get("/me", (request, response) => {
    response.json({
      user: { id: request.user.id }
    });
  });

  router.post("/logout", (request, response, next) => {
    if (
      request.get("x-csrf-token") !== request.session.csrfToken
    ) {
      return response.status(403).json({
        error: "CSRF_INVALID"
      });
    }

    request.session.destroy((error) => {
      if (error) {
        return next(error);
      }

      response.clearCookie("revokx.sid", {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: false
      });

      response.status(204).end();
    });
  });

  return router;
}