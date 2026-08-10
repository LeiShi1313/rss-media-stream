import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../../config.js";
import { audit } from "../../core/audit.js";
import { requireTenantRole } from "../../core/permissions.js";
import { parseBody, parseParams, parseQuery } from "../../core/validation.js";
import {
  createSubscriptionWithRule,
  deleteSubscription,
  getSubscription,
  listMatchHistory,
  listSubscriptionHistory,
  listSubscriptions,
  replaceSubscriptionRule,
  type SubscriptionActor,
  updateSubscription
} from "./subscriptionManagement.js";
import {
  matchHistoryQuerySchema,
  subscriptionCreateSchema,
  subscriptionListQuerySchema,
  subscriptionParamsSchema
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
      return listSubscriptions({
        actor: subscriptionActor(request),
        scope: query.scope
      });
    }
  );

  app.post(
    "/api/subscriptions",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const input = parseBody(subscriptionCreateSchema, request);
      const subscription = await createSubscriptionWithRule({
        actor: subscriptionActor(request),
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
      return getSubscription({ actor: subscriptionActor(request), id });
    }
  );

  app.patch(
    "/api/subscriptions/:id",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { id } = parseParams(subscriptionParamsSchema, request);
      const subscription = await updateSubscription({
        actor: subscriptionActor(request),
        id,
        patch: request.body
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
      const result = await deleteSubscription({
        actor: subscriptionActor(request),
        id
      });

      await audit(request, "subscription.delete", "subscription", id);
      return result;
    }
  );

  app.put(
    "/api/subscriptions/:id/rule",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { id } = parseParams(subscriptionParamsSchema, request);
      const subscription = await replaceSubscriptionRule({
        actor: subscriptionActor(request),
        id,
        rule: request.body
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
      return listSubscriptionHistory({
        actor: subscriptionActor(request),
        id
      });
    }
  );

  app.get(
    "/api/match-history",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const query = parseQuery(matchHistoryQuerySchema, request);
      return listMatchHistory({
        actor: subscriptionActor(request),
        query
      });
    }
  );
}

function subscriptionActor(request: FastifyRequest): SubscriptionActor {
  return {
    tenantId: request.tenantId!,
    userId: request.currentUser!.id,
    role: request.currentMembership!.role
  };
}
