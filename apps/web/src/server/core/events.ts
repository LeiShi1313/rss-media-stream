import type { FastifyInstance, FastifyReply } from "fastify";
import { redactSecrets } from "@rss-media/shared/redact";
import { requireTenantRole } from "./permissions.js";

type EventClient = {
  tenantId: string;
  userId: string;
  reply: FastifyReply;
  heartbeat: NodeJS.Timeout;
};

export type TenantEventPayload = {
  tenantId: string;
  type: string;
  data: unknown;
};

const clients = new Set<EventClient>();
const heartbeatIntervalMs = 30_000;

export async function registerEventRoutes(app: FastifyInstance) {
  app.get(
    "/events",
    { preHandler: requireTenantRole("VIEWER") },
    async (request, reply) => {
      addEventClient({
        tenantId: request.tenantId!,
        userId: request.currentUser!.id,
        reply
      });
    }
  );
}

export function addEventClient(input: Omit<EventClient, "heartbeat">) {
  input.reply.hijack();
  input.reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  writeSse(input.reply, "ready", {});

  const client: EventClient = {
    ...input,
    heartbeat: setInterval(() => {
      if (!writeSse(input.reply, "ping", {})) removeEventClient(client);
    }, heartbeatIntervalMs)
  };
  client.heartbeat.unref?.();

  clients.add(client);

  const cleanup = () => removeEventClient(client);
  input.reply.raw.on("close", cleanup);
  input.reply.raw.on("error", cleanup);
}

export function publishTenantEvent(payload: TenantEventPayload) {
  const eventType = sanitizeEventType(payload.type);
  const data = sanitizeEventData(payload.data);
  let delivered = 0;

  for (const client of clients) {
    if (client.tenantId !== payload.tenantId) continue;
    if (writeSse(client.reply, eventType, data)) delivered += 1;
    else removeEventClient(client);
  }

  return delivered;
}

function removeEventClient(client: EventClient) {
  clearInterval(client.heartbeat);
  clients.delete(client);
}

function writeSse(reply: FastifyReply, eventType: string, data: unknown) {
  if (reply.raw.destroyed || reply.raw.closed) return false;

  try {
    reply.raw.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function sanitizeEventType(type: string) {
  return type.replace(/[^\w.-]/g, ".");
}

function sanitizeEventData(data: unknown): unknown {
  return sanitizeValue(data, 0, new WeakSet<object>());
}

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 6) return "[redacted]";

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveEventKey(key)) continue;
      result[key] = sanitizeValue(entry, depth + 1, seen);
    }
    return result;
  }

  return undefined;
}

function isSensitiveEventKey(key: string) {
  return /password|secret|token|authorization|cookie|credential|passkey|url|torrent|encrypted|raw|guid|linkhash/i.test(
    key
  );
}
