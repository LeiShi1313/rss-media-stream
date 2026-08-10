import { request } from "node:http";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerClientStatic } from "../src/server/http/static-client.js";

describe("client static file security", () => {
  it("does not let a non-canonical path bypass a guarded static route", async () => {
    const app = Fastify();

    app.get(
      "/main.tsx",
      {
        onRequest: async (_request, reply) => reply.code(403).send()
      },
      async () => undefined
    );
    await registerClientStatic(app);

    try {
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const port = Number(new URL(address).port);
      const guardedStatus = await requestStatus(port, "/main.tsx");
      const bypassStatus = await requestStatus(port, "/public/../main.tsx");

      expect(guardedStatus).toBe(403);
      expect(bypassStatus).toBe(403);
    } finally {
      await app.close();
    }
  });
});

function requestStatus(port: number, path: string) {
  return new Promise<number | undefined>((resolve, reject) => {
    const clientRequest = request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      }
    );

    clientRequest.once("error", reject);
    clientRequest.end();
  });
}
