import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { authenticateUser, listUserWorkspaces } from "../../core/context.js";
import { requireTenantRole, requireUser } from "../../core/permissions.js";
import { parseBody } from "../../core/validation.js";
import { audit } from "../../core/audit.js";
import { setSessionCookie } from "../auth/auth.routes.js";

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const switchWorkspaceSchema = z.object({
  workspaceId: z.string().min(1)
});

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

export async function registerWorkspaceRoutes(app: FastifyInstance, config: AppConfig) {
  app.get("/api/workspaces", { preHandler: requireUser }, async (request) => {
    const user = await authenticateUser(request);
    return listUserWorkspaces(user.id);
  });

  app.post("/api/workspaces", { preHandler: requireUser }, async (request, reply) => {
    const user = await authenticateUser(request);
    const input = parseBody(createWorkspaceSchema, request);
    const tenant = await prisma.tenant.create({
      data: {
        name: input.name,
        memberships: {
          create: {
            userId: user.id,
            role: "OWNER"
          }
        },
        settings: {
          create: {}
        }
      },
      select: { id: true, name: true }
    });

    setSessionCookie(app, reply, config, user.id, tenant.id);
    return { id: tenant.id, name: tenant.name, role: "OWNER" };
  });

  app.post("/api/workspaces/switch", { preHandler: requireUser }, async (request, reply) => {
    const user = await authenticateUser(request);
    const input = parseBody(switchWorkspaceSchema, request);
    const membership = await prisma.tenantMembership.findFirst({
      where: { userId: user.id, tenantId: input.workspaceId },
      include: { tenant: { select: { id: true, name: true } } }
    });

    if (!membership) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "Workspace not found" });
    }

    setSessionCookie(app, reply, config, user.id, membership.tenantId);
    return {
      id: membership.tenant.id,
      name: membership.tenant.name,
      role: membership.role
    };
  });

  app.get("/api/workspace", { preHandler: requireTenantRole("VIEWER") }, async (request) => {
    return {
      id: request.tenantId,
      name: request.currentMembership!.tenantName,
      role: request.currentMembership!.role
    };
  });

  app.patch("/api/workspace", { preHandler: requireTenantRole("OWNER") }, async (request) => {
    const input = parseBody(updateWorkspaceSchema, request);
    const tenant = await prisma.tenant.update({
      where: { id: request.tenantId! },
      data: { name: input.name },
      select: { id: true, name: true, updatedAt: true }
    });

    await audit(request, "workspace.update", "tenant", tenant.id);
    return tenant;
  });
}
