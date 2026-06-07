import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { authenticateUser, listUserWorkspaces } from "../../core/context.js";
import { requireTenantRole, requireUser } from "../../core/permissions.js";
import { parseBody } from "../../core/validation.js";
import { audit } from "../../core/audit.js";
import { setSessionCookie } from "../auth/auth.routes.js";
import { getTmdbCredentialStatus, validateTmdbCredential } from "../../integrations/tmdb/client.js";
import { encryptSecret } from "../../secrets.js";
import { badRequest } from "../../core/errors.js";

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const switchWorkspaceSchema = z.object({
  workspaceId: z.string().min(1)
});

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const updateTmdbSettingsSchema = z.object({
  apiKey: z.string().trim().max(5000).optional()
});

const mediaLanguageSchema = z.enum(["en-US", "zh-CN", "zh-TW", "ja-JP", "ko-KR", "fr-FR", "de-DE", "es-ES"]);
const webLanguageSchema = z.enum(["en-US", "zh-CN"]);

const updateSettingsSchema = z.object({
  apiKey: z.string().trim().max(5000).optional(),
  tmdbLanguage: mediaLanguageSchema.optional(),
  webLanguage: webLanguageSchema.optional()
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

  app.get(
    "/api/workspace/integrations/tmdb",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => getTmdbCredentialStatus(config, request.tenantId!)
  );

  app.get(
    "/api/settings",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => getTmdbCredentialStatus(config, request.tenantId!)
  );

  app.put(
    "/api/settings",
    { preHandler: requireTenantRole("OWNER") },
    async (request) => updateSettings(request, config, parseBody(updateSettingsSchema, request))
  );

  app.put(
    "/api/workspace/integrations/tmdb",
    { preHandler: requireTenantRole("OWNER") },
    async (request) => {
      const input = parseBody(updateTmdbSettingsSchema, request);
      return updateSettings(request, config, input);
    }
  );
}

async function updateSettings(
  request: FastifyRequest,
  config: AppConfig,
  input: z.infer<typeof updateSettingsSchema>
) {
  const apiKey = input.apiKey?.trim();
  const existingSettings = await prisma.tenantSettings.findUnique({
    where: { tenantId: request.tenantId! },
    select: { tmdbLanguage: true }
  });
  const tmdbLanguageChanged = Boolean(
    input.tmdbLanguage && input.tmdbLanguage !== (existingSettings?.tmdbLanguage ?? "en-US")
  );
  const baseData = {
    ...(input.tmdbLanguage ? { tmdbLanguage: input.tmdbLanguage } : {}),
    ...(input.webLanguage ? { webLanguage: input.webLanguage } : {})
  };

  if (apiKey === "") {
    await prisma.tenantSettings.upsert({
      where: { tenantId: request.tenantId! },
      create: {
        tenantId: request.tenantId!,
        encryptedTmdbApiKey: null,
        tmdbConfiguredAt: null,
        tmdbLastValidatedAt: null,
        tmdbLastError: null,
        ...baseData
      },
      update: {
        encryptedTmdbApiKey: null,
        tmdbConfiguredAt: null,
        tmdbLastValidatedAt: null,
        tmdbLastError: null,
        ...baseData
      }
    });
    await prisma.tmdbCache.deleteMany({ where: { tenantId: request.tenantId! } });
    await audit(request, "settings.tmdb.clear", "tenant", request.tenantId!);
    return getTmdbCredentialStatus(config, request.tenantId!);
  }

  if (apiKey) {
    try {
      await validateTmdbCredential(apiKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.tenantSettings.upsert({
        where: { tenantId: request.tenantId! },
        create: {
          tenantId: request.tenantId!,
          tmdbLastError: message,
          ...baseData
        },
        update: {
          tmdbLastError: message,
          ...baseData
        }
      });
      throw badRequest(message);
    }

    const now = new Date();
    await prisma.tenantSettings.upsert({
      where: { tenantId: request.tenantId! },
      create: {
        tenantId: request.tenantId!,
        encryptedTmdbApiKey: encryptSecret(apiKey, config.appSecret),
        tmdbConfiguredAt: now,
        tmdbLastValidatedAt: now,
        tmdbLastError: null,
        ...baseData
      },
      update: {
        encryptedTmdbApiKey: encryptSecret(apiKey, config.appSecret),
        tmdbConfiguredAt: now,
        tmdbLastValidatedAt: now,
        tmdbLastError: null,
        ...baseData
      }
    });
    await prisma.tmdbCache.deleteMany({ where: { tenantId: request.tenantId! } });
    await audit(request, "settings.tmdb.update", "tenant", request.tenantId!);
    return getTmdbCredentialStatus(config, request.tenantId!);
  }

  await prisma.tenantSettings.upsert({
    where: { tenantId: request.tenantId! },
    create: { tenantId: request.tenantId!, ...baseData },
    update: baseData
  });
  if (tmdbLanguageChanged) {
    await prisma.tmdbCache.deleteMany({ where: { tenantId: request.tenantId! } });
  }
  await audit(request, "settings.update", "tenant", request.tenantId!, {
    tmdbLanguage: input.tmdbLanguage,
    webLanguage: input.webLanguage
  });
  return getTmdbCredentialStatus(config, request.tenantId!);
}
