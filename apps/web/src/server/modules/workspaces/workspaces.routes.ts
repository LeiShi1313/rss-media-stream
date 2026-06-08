import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { authenticateUser, listUserWorkspaces } from "../../core/context.js";
import { requireTenantRole, requireUser } from "../../core/permissions.js";
import { parseBody, parseParams } from "../../core/validation.js";
import { audit } from "../../core/audit.js";
import { setSessionCookie } from "../auth/auth.routes.js";
import {
  getProviderPolicies,
  replaceMediaProviderPolicies
} from "../../integrations/providers/policy.js";
import {
  listProviderSettings,
  upsertProviderSettings
} from "../../integrations/providers/runtime.js";

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const switchWorkspaceSchema = z.object({
  workspaceId: z.string().min(1)
});

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const mediaLanguageSchema = z.enum(["en-US", "zh-CN", "zh-TW", "ja-JP", "ko-KR", "fr-FR", "de-DE", "es-ES"]);
const webLanguageSchema = z.enum(["en-US", "zh-CN"]);
const providerSchema = z.enum(["tmdb", "tvdb"]);
const concreteMediaTypeSchema = z.enum(["MOVIE", "TV_SERIES"]);

const updateSettingsSchema = z.object({
  webLanguage: webLanguageSchema.optional()
});

const providerParamsSchema = z.object({
  provider: providerSchema
});

const providerSettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  secrets: z.record(z.string(), z.string().trim().max(5000)).optional(),
  clearSecrets: z.boolean().optional(),
  metadataLanguage: mediaLanguageSchema.nullable().optional(),
  region: z.string().trim().max(20).nullable().optional()
});

const providerPolicyUpdateSchema = z.object({
  mediaType: concreteMediaTypeSchema,
  policies: z.array(z.object({
    provider: providerSchema,
    enabledForMatching: z.boolean(),
    enabledForPresentation: z.boolean(),
    matchingPriority: z.coerce.number().int().positive(),
    presentationPriority: z.coerce.number().int().positive()
  }))
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
    "/api/settings",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => getSettings(request.tenantId!)
  );

  app.put(
    "/api/settings",
    { preHandler: requireTenantRole("OWNER") },
    async (request) => updateSettings(request, parseBody(updateSettingsSchema, request))
  );

  app.get(
    "/api/settings/providers",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => listProviderSettings(config, request.tenantId!)
  );

  app.put(
    "/api/settings/providers/:provider",
    { preHandler: requireTenantRole("OWNER") },
    async (request) => {
      const { provider } = parseParams(providerParamsSchema, request);
      const input = parseBody(providerSettingsUpdateSchema, request);
      await upsertProviderSettings({
        config,
        tenantId: request.tenantId!,
        provider,
        ...input
      });
      await audit(request, "settings.provider.update", "tenant", request.tenantId!, {
        provider,
        enabled: input.enabled,
        clearSecrets: input.clearSecrets,
        metadataLanguage: input.metadataLanguage,
        region: input.region
      });
      return listProviderSettings(config, request.tenantId!);
    }
  );

  app.get(
    "/api/settings/media-provider-policies",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => getProviderPolicies(request.tenantId!)
  );

  app.put(
    "/api/settings/media-provider-policies",
    { preHandler: requireTenantRole("OWNER") },
    async (request) => {
      const input = parseBody(providerPolicyUpdateSchema, request);
      await replaceMediaProviderPolicies(request.tenantId!, input.mediaType, input.policies);
      await audit(request, "settings.provider_policy.update", "tenant", request.tenantId!, {
        mediaType: input.mediaType
      });
      return getProviderPolicies(request.tenantId!);
    }
  );
}

async function updateSettings(
  request: FastifyRequest,
  input: z.infer<typeof updateSettingsSchema>
) {
  await prisma.tenantSettings.upsert({
    where: { tenantId: request.tenantId! },
    create: { tenantId: request.tenantId!, ...input },
    update: input
  });
  await audit(request, "settings.update", "tenant", request.tenantId!, {
    webLanguage: input.webLanguage
  });
  return getSettings(request.tenantId!);
}

async function getSettings(tenantId: string) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { webLanguage: true }
  });
  return {
    webLanguage: settings?.webLanguage ?? "en-US"
  };
}
