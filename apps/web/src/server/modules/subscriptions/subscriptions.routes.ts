import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { audit } from "../../core/audit.js";
import { forbidden } from "../../core/errors.js";
import { isAdminRole, requireTenantRole } from "../../core/permissions.js";
import { parseBody, parseParams, parseQuery } from "../../core/validation.js";
import {
  createSubscriptionWithRule,
  deleteSubscription,
  listMatchHistory,
  listSubscriptionHistory,
  listSubscriptions,
  requireOwnSubscriptionOrAdmin,
  serializeSubscription,
  updateSubscription,
  updateSubscriptionRule
} from "./subscriptions.service.js";
import {
  matchHistoryQuerySchema,
  subscriptionCreateSchema,
  subscriptionListQuerySchema,
  subscriptionParamsSchema,
  subscriptionPatchSchema,
  subscriptionRuleSchema
} from "./subscriptions.schemas.js";

export async function registerSubscriptionRoutes(
  app: FastifyInstance,
  _config: AppConfig
) {
  app.get(
    "/api/subscriptions",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const query = parseQuery(subscriptionListQuerySchema, request);
      const canSeeAll = isAdminRole(request.currentMembership!.role);
      if (query.scope === "all" && !canSeeAll) throw forbidden();

      return listSubscriptions({
        tenantId: request.tenantId!,
        userId: request.currentUser!.id,
        scope: query.scope,
        canSeeAll
      });
    }
  );

  app.post(
    "/api/subscriptions",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const input = parseBody(subscriptionCreateSchema, request);
      const subscription = await createSubscriptionWithRule({
        tenantId: request.tenantId!,
        userId: request.currentUser!.id,
        input
      });

      await audit(request, "subscription.create", "subscription", subscription.id);
      return subscription;
    }
  );

  app.get(
    "/api/subscriptions/:id",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { id } = parseParams(subscriptionParamsSchema, request);
      const subscription = await requireOwnSubscriptionOrAdmin(request, id);
      return serializeSubscription(subscription);
    }
  );

  app.patch(
    "/api/subscriptions/:id",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { id } = parseParams(subscriptionParamsSchema, request);
      await requireOwnSubscriptionOrAdmin(request, id);
      const patch = parseBody(subscriptionPatchSchema, request);
      const subscription = await updateSubscription({
        tenantId: request.tenantId!,
        id,
        patch
      });

      await audit(request, "subscription.update", "subscription", id);
      return subscription;
    }
  );

  app.delete(
    "/api/subscriptions/:id",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { id } = parseParams(subscriptionParamsSchema, request);
      await requireOwnSubscriptionOrAdmin(request, id);
      const result = await deleteSubscription(request.tenantId!, id);

      await audit(request, "subscription.delete", "subscription", id);
      return result;
    }
  );

  app.put(
    "/api/subscriptions/:id/rule",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { id } = parseParams(subscriptionParamsSchema, request);
      await requireOwnSubscriptionOrAdmin(request, id);
      const rule = parseBody(subscriptionRuleSchema, request);
      const subscription = await updateSubscriptionRule({
        tenantId: request.tenantId!,
        subscriptionId: id,
        rule
      });

      await audit(request, "subscription_rule.update", "subscription", id);
      return subscription;
    }
  );

  app.get(
    "/api/subscriptions/:id/history",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { id } = parseParams(subscriptionParamsSchema, request);
      await requireOwnSubscriptionOrAdmin(request, id);
      return listSubscriptionHistory({
        tenantId: request.tenantId!,
        subscriptionId: id
      });
    }
  );

  app.get(
    "/api/match-history",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const query = parseQuery(matchHistoryQuerySchema, request);
      return listMatchHistory({
        tenantId: request.tenantId!,
        userId: request.currentUser!.id,
        canSeeAll: isAdminRole(request.currentMembership!.role),
        query
      });
    }
  );
}
