import type { FastifyInstance, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { authenticateUser, listUserWorkspaces, resolveTenantContext } from "../../core/context.js";
import { conflict } from "../../core/errors.js";
import { requireUser } from "../../core/permissions.js";
import { parseBody } from "../../core/validation.js";

const setupSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(10).max(200),
  workspaceName: z.string().trim().min(1).max(120).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function registerAuthRoutes(app: FastifyInstance, config: AppConfig) {
  app.get("/api/setup/status", async () => {
    const count = await prisma.user.count();
    return { required: count === 0 };
  });

  app.post("/api/setup", async (request, reply) => {
    const existing = await prisma.user.count();
    if (existing > 0) {
      throw conflict("SETUP_COMPLETE", "Setup has already been completed");
    }

    const input = parseBody(setupSchema, request);
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email.toLowerCase(),
          name: input.name,
          passwordHash: await bcrypt.hash(input.password, 12)
        },
        select: { id: true, email: true, name: true }
      });

      const tenant = await tx.tenant.create({
        data: {
          name: input.workspaceName ?? `${input.name}'s Workspace`,
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

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          action: "setup.create_owner",
          entityType: "user",
          entityId: user.id
        }
      });

      return { user, tenant, role: "OWNER" as const };
    });

    setSessionCookie(app, reply, config, result.user.id, result.tenant.id);
    return {
      user: result.user,
      workspace: {
        id: result.tenant.id,
        name: result.tenant.name,
        role: result.role
      }
    };
  });

  app.post("/api/login", async (request, reply) => {
    const input = parseBody(loginSchema, request);
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      select: { id: true, email: true, name: true, passwordHash: true }
    });

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return reply.code(401).send({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    }

    const memberships = await listUserWorkspaces(user.id);
    const activeWorkspace = memberships[0];
    setSessionCookie(app, reply, config, user.id, activeWorkspace?.id);

    return {
      user: { id: user.id, email: user.email, name: user.name },
      activeWorkspace,
      workspaces: memberships
    };
  });

  app.post("/api/logout", async (_request, reply) => {
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireUser }, async (request) => {
    const user = await authenticateUser(request);
    const workspaces = await listUserWorkspaces(user.id);
    let activeWorkspace = undefined;

    try {
      const context = await resolveTenantContext(request);
      activeWorkspace = workspaces.find((workspace) => workspace.id === context.tenantId);
    } catch {
      activeWorkspace = undefined;
    }

    return { user, activeWorkspace, workspaces };
  });
}

export function setSessionCookie(
  app: FastifyInstance,
  reply: FastifyReply,
  config: AppConfig,
  userId: string,
  activeTenantId?: string
) {
  const token = app.jwt.sign({ activeTenantId }, { sub: userId, expiresIn: "14d" });
  reply.setCookie("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/"
  });
}
