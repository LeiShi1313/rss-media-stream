import type { FastifyReply } from "fastify";

type EventPayload = {
  type: string;
  data: unknown;
};

const clients = new Set<FastifyReply>();

export function addEventClient(reply: FastifyReply) {
  clients.add(reply);
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  reply.raw.write("event: ready\ndata: {}\n\n");
  reply.raw.on("close", () => clients.delete(reply));
}

export function publishEvent(payload: EventPayload) {
  const message = `event: ${payload.type}\ndata: ${JSON.stringify(payload.data)}\n\n`;
  for (const client of clients) {
    client.raw.write(message);
  }
}
