import express from "express";
import session from "express-session";
import { randomBytes } from "node:crypto";
import { createAuthRouter } from "./auth.js";
import { createTeamRouter } from "./team.js";

export function createApp({ mode = "fixed" } = {}) {
  const teamRouter = createTeamRouter({ mode });
  const app = express();

  app.disable("x-powered-by");

  app.use((request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  app.get("/health", (request, response) => {
    response.status(200).json({
      service: "revokx-demo",
      status: "ok"
    });
  });

  app.use(express.json({ limit: "8kb" }));

  app.use(
    session({
      name: "revokx.sid",
      secret: randomBytes(32).toString("hex"),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "strict",
        secure: false,
        maxAge: 15 * 60 * 1000
      }
    })
  );

  app.use("/auth", createAuthRouter());
  app.use("/team", teamRouter);

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      return next(error);
    }

    if (error.type === "entity.parse.failed") {
      return response.status(400).json({
        error: "INVALID_JSON"
      });
    }

    if (error.type === "entity.too.large") {
      return response.status(413).json({
        error: "BODY_TOO_LARGE"
      });
    }

    response.status(500).json({
      error: "INTERNAL_ERROR"
    });
  });

  return app;
}