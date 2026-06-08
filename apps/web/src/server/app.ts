import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import Fastify from "fastify";
import type { AppConfig } from "./config.js";
import { registerErrorHandler } from "./core/errors.js";
import { registerEventRoutes } from "./core/events.js";
import { registerClientStatic } from "./http/static-client.js";
import { registerAppRoutes } from "./modules/index.js";

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: {
      redact: [
        "req.headers.cookie",
        "req.headers.authorization",
        "req.body.password",
        "req.body.url"
      ]
    }
  });

  registerErrorHandler(app);

  await app.register(fastifyCors, {
    origin: config.clientOrigin,
    credentials: true
  });
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
    cookie: {
      cookieName: "session",
      signed: false
    }
  });

  app.get("/api/health", async () => ({ ok: true }));

  await registerEventRoutes(app);
  await registerAppRoutes(app, config);
  await registerClientStatic(app);

  return app;
}
