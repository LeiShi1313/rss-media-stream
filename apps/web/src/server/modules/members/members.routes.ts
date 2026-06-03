import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { audit } from "../../core/audit.js";
import { conflict, notFound } from "../../core/errors.js";
import { requireTenantRole } from "../../core/permissions.js";
import { parseBody, parseParams } from "../../core/validation.js";

const roleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);

const addMemberSchema = z.object({
  email: z.string().email(),
  role: roleSchema.default("MEMBER")
});

const memberParamsSchema = z.object({
  userId: z.string().min(1)
});

const patchMemberSchema = z.object({
  role: roleSchema
});

export async function registerMemberRoutes(app: FastifyInstance) {
  app.get(
    "/api/workspace/members",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      const members = await prisma.tenantMembership.findMany({
        where: { tenantId: request.tenantId! },
        include: { user: { select: { id: true, email: true, name: true } } },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }]
      });

      return members.map((member) => ({
        userId: member.userId,
        email: member.user.email,
        name: member.user.name,
        role: member.role,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt
      }));
    }
  );

  app.post(
    "/api/workspace/members",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const input = parseBody(addMemberSchema, request);
      const user = await prisma.user.findUnique({
        where: { email: input.email.toLowerCase() },
        select: { id: true, email: true, name: true }
      });
      if (!user) throw notFound("User");

      const member = await prisma.tenantMembership.upsert({
        where: {
          tenantId_userId: {
            tenantId: request.tenantId!,
            userId: user.id
          }
        },
        create: {
          tenantId: request.tenantId!,
          userId: user.id,
          role: input.role
        },
        update: { role: input.role },
        include: { user: { select: { id: true, email: true, name: true } } }
      });

      await audit(request, "member.upsert", "user", user.id, { role: input.role });
      return {
        userId: member.userId,
        email: member.user.email,
        name: member.user.name,
        role: member.role
      };
    }
  );

  app.patch(
    "/api/workspace/members/:userId",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const params = parseParams(memberParamsSchema, request);
      const input = parseBody(patchMemberSchema, request);
      await assertCanChangeOwnerRole(request.tenantId!, params.userId, input.role);

      const member = await prisma.tenantMembership.update({
        where: {
          tenantId_userId: {
            tenantId: request.tenantId!,
            userId: params.userId
          }
        },
        data: { role: input.role },
        include: { user: { select: { id: true, email: true, name: true } } }
      });

      await audit(request, "member.update", "user", params.userId, { role: input.role });
      return {
        userId: member.userId,
        email: member.user.email,
        name: member.user.name,
        role: member.role
      };
    }
  );

  app.delete(
    "/api/workspace/members/:userId",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const params = parseParams(memberParamsSchema, request);
      await assertCanRemoveMember(request.tenantId!, params.userId);

      await prisma.tenantMembership.delete({
        where: {
          tenantId_userId: {
            tenantId: request.tenantId!,
            userId: params.userId
          }
        }
      });

      await audit(request, "member.remove", "user", params.userId);
      return { userId: params.userId };
    }
  );
}

async function assertCanChangeOwnerRole(
  tenantId: string,
  userId: string,
  nextRole: string
) {
  const existing = await prisma.tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { role: true }
  });
  if (!existing) throw notFound("Member");

  if (existing.role === "OWNER" && nextRole !== "OWNER") {
    await assertAnotherOwnerExists(tenantId, userId);
  }
}

async function assertCanRemoveMember(tenantId: string, userId: string) {
  const existing = await prisma.tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { role: true }
  });
  if (!existing) throw notFound("Member");

  if (existing.role === "OWNER") {
    await assertAnotherOwnerExists(tenantId, userId);
  }
}

async function assertAnotherOwnerExists(tenantId: string, userId: string) {
  const ownerCount = await prisma.tenantMembership.count({
    where: {
      tenantId,
      role: "OWNER",
      userId: { not: userId }
    }
  });

  if (ownerCount === 0) {
    throw conflict("LAST_OWNER_REQUIRED", "Workspace must keep at least one owner");
  }
}
