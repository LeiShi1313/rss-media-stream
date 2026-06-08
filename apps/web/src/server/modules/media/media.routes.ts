import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { audit } from "../../core/audit.js";
import { requireTenantRole } from "../../core/permissions.js";
import { parseBody, parseParams, parseQuery } from "../../core/validation.js";
import { evaluateAutoDownloadsForItem } from "../subscriptions/subscriptions.service.js";
import {
  getMediaDetail,
  getMedia,
  listMediaItems,
  listTrendingMedia,
  manuallyMatchParsedReleaseWithProvider,
  matchParsedReleaseForItem,
  searchLocalMedia,
  searchExternalMedia,
  smartSearchExternalMedia
} from "./media.service.js";
import {
  itemParamsSchema,
  localMediaSearchQuerySchema,
  manualProviderMatchSchema,
  mediaParamsSchema,
  mediaSearchQuerySchema,
  smartProviderTitleSearchSchema,
  trendingMediaQuerySchema
} from "./media.schemas.js";

export async function registerMediaRoutes(app: FastifyInstance, config: AppConfig) {
  app.get(
    "/api/media-titles",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const query = parseQuery(localMediaSearchQuerySchema, request);
      return searchLocalMedia(request.tenantId!, query);
    }
  );

  app.get(
    "/api/media-titles/trending",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      const query = parseQuery(trendingMediaQuerySchema, request);
      return listTrendingMedia(request.tenantId!, query);
    }
  );

  app.get(
    "/api/provider-titles/search",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const query = parseQuery(mediaSearchQuerySchema, request);
      return searchExternalMedia(config, request.tenantId!, query);
    }
  );

  app.post(
    "/api/provider-titles/search",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const query = parseBody(smartProviderTitleSearchSchema, request);
      const results = await smartSearchExternalMedia(config, request.tenantId!, query);
      return { results };
    }
  );

  app.get(
    "/api/media-titles/:mediaId",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { mediaId } = parseParams(mediaParamsSchema, request);
      return getMedia(request.tenantId!, mediaId);
    }
  );

  app.get(
    "/api/media-titles/:mediaId/detail",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { mediaId } = parseParams(mediaParamsSchema, request);
      return getMediaDetail(request.tenantId!, mediaId);
    }
  );

  app.get(
    "/api/media-titles/:mediaId/items",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { mediaId } = parseParams(mediaParamsSchema, request);
      return listMediaItems(request.tenantId!, mediaId);
    }
  );

  app.post(
    "/api/items/:itemId/match",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const { itemId } = parseParams(itemParamsSchema, request);
      const match = await matchParsedReleaseForItem({
        tenantId: request.tenantId!,
        itemId,
        config
      });

      await audit(request, "media_match.run", "item", itemId, {
        status: match.status,
        providerTitleId: match.providerTitleId,
        mediaTitleId: match.mediaTitleId,
        reason: match.reason
      });

      await evaluateAutoDownloadsForItem({
        tenantId: request.tenantId!,
        itemId,
        config
      });

      return {
        id: match.id,
        status: match.status,
        mediaTitleId: match.mediaTitleId,
        providerTitleId: match.providerTitleId,
        reason: match.reason
      };
    }
  );

  app.post(
    "/api/items/:itemId/match/manual",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const { itemId } = parseParams(itemParamsSchema, request);
      const input = parseBody(manualProviderMatchSchema, request);
      const match = await manuallyMatchParsedReleaseWithProvider({
        tenantId: request.tenantId!,
        itemId,
        config,
        ...input
      });

      await audit(request, "media_match.manual_provider", "item", itemId, {
        itemId,
        provider: input.provider,
        providerId: input.providerId,
        providerTitleId: match.providerTitleId,
        mediaTitleId: match.mediaTitleId,
        mediaType: input.mediaType
      });

      await evaluateAutoDownloadsForItem({
        tenantId: request.tenantId!,
        itemId,
        config
      });

      return {
        id: match.id,
        status: match.status,
        mediaTitleId: match.mediaTitleId,
        providerTitleId: match.providerTitleId,
        reason: match.reason
      };
    }
  );
}
