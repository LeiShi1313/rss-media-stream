import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

export async function registerClientStatic(app: FastifyInstance) {
  const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "../../client");
  if (!existsSync(clientRoot)) return;

  await app.register(fastifyStatic, { root: clientRoot, prefix: "/" });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api") || request.url.startsWith("/events")) {
      reply.code(404).send({ message: "Not found" });
    } else {
      reply.sendFile("index.html");
    }
  });
}
