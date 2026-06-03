import type { FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export async function audit(
  request: FastifyRequest,
  action: string,
  entityType: string,
  entityId?: string,
  metadata?: unknown
) {
  if (!request.tenantId) return;

  await prisma.auditLog.create({
    data: {
      tenantId: request.tenantId,
      userId: request.currentUser?.id,
      action,
      entityType,
      entityId,
      metadata: metadata === undefined ? undefined : toJson(metadata)
    }
  });
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
