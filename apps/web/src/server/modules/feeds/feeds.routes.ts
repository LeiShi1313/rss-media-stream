import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { audit } from "../../core/audit.js";
import { requireTenantRole } from "../../core/permissions.js";
import { parseBody, parseParams, parseQuery } from "../../core/validation.js";
import {
  createFeed,
  deleteFeed,
  getFeed,
  listFeedItems,
  listFeeds,
  refreshFeed,
  updateFeed
} from "./feeds.service.js";
import {
  createFeedSchema,
  feedParamsSchema,
  patchFeedSchema
} from "./feeds.schemas.js";
import { itemQuerySchema } from "../items/items.schemas.js";

export async function registerFeedRoutes(
  app: FastifyInstance,
  config: AppConfig
) {
  app.get(
    "/api/feeds",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      return listFeeds(request.tenantId!);
    }
  );

  app.post(
    "/api/feeds",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const input = parseBody(createFeedSchema, request);
      const feed = await createFeed(input, {
        tenantId: request.tenantId!,
        userId: request.currentUser!.id
      });

      await audit(request, "feed.create", "feed", feed.id);
      return feed;
    }
  );

  app.get(
    "/api/feeds/:feedId",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      const params = parseParams(feedParamsSchema, request);
      return getFeed(request.tenantId!, params.feedId);
    }
  );

  app.patch(
    "/api/feeds/:feedId",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const params = parseParams(feedParamsSchema, request);
      const patch = parseBody(patchFeedSchema, request);
      const feed = await updateFeed({
        tenantId: request.tenantId!,
        feedId: params.feedId,
        patch
      });

      await audit(request, "feed.update", "feed", feed.id);
      return feed;
    }
  );

  app.delete(
    "/api/feeds/:feedId",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const params = parseParams(feedParamsSchema, request);
      const feed = await deleteFeed(request.tenantId!, params.feedId);

      await audit(request, "feed.delete", "feed", feed.id);
      return feed;
    }
  );

  app.post(
    "/api/feeds/:feedId/refresh",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const params = parseParams(feedParamsSchema, request);
      const result = await refreshFeed(params.feedId, {
        tenantId: request.tenantId!,
        actor: { userId: request.currentUser!.id }
      }, {
        config
      });

      await audit(request, "feed.refresh", "feed", params.feedId, result);
      return result;
    }
  );

  app.get(
    "/api/feeds/:feedId/items",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      const params = parseParams(feedParamsSchema, request);
      const query = parseQuery(itemQuerySchema, request);
      return listFeedItems(request.tenantId!, params.feedId, query);
    }
  );
}
