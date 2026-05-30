import type { PrismaClient } from "@prisma/client";

export async function audit(
  prisma: PrismaClient,
  input: {
    userId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: unknown;
  }
) {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata === undefined ? undefined : (input.metadata as object)
    }
  });
}
