import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { audit } from "../../core/audit.js";
import { requireTenantRole } from "../../core/permissions.js";
import { parseBody, parseParams, parseQuery } from "../../core/validation.js";
import { evaluateAutoDownloadsForItem } from "../subscriptions/subscriptions.service.js";
import {
  acceptCandidate,
  getMedia,
  importMedia,
  listMatchCandidates,
  listMediaItems,
  matchItemWithExternalMedia,
  searchExternalMedia
} from "./media.service.js";
import {
  acceptCandidateParamsSchema,
  itemParamsSchema,
  mediaImportSchema,
  mediaParamsSchema,
  mediaSearchQuerySchema
} from "./media.schemas.js";

export async function registerMediaRoutes(app: FastifyInstance, config: AppConfig) {
  app.get(
    "/api/media/search",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const query = parseQuery(mediaSearchQuerySchema, request);
      const results = await searchExternalMedia(config, query);

      return results.map((item) => ({
        provider: item.provider,
        providerId: item.providerId,
        kind: item.kind,
        title: item.title,
        originalTitle: item.originalTitle,
        year: item.year,
        posterPath: item.posterPath,
        score: item.score
      }));
    }
  );

  app.post(
    "/api/media/import",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const input = parseBody(mediaImportSchema, request);
      const media = await importMedia(request.tenantId!, input);

      await audit(request, "media.import", "media", media.id, {
        provider: media.provider,
        providerId: media.providerId
      });

      return media;
    }
  );

  app.get(
    "/api/media/:mediaId",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { mediaId } = parseParams(mediaParamsSchema, request);
      return getMedia(request.tenantId!, mediaId);
    }
  );

  app.get(
    "/api/media/:mediaId/items",
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
      const match = await matchItemWithExternalMedia({
        tenantId: request.tenantId!,
        itemId,
        config
      });

      await audit(request, "media_match.run", "item", itemId, {
        status: match.status,
        provider: match.provider,
        providerId: match.providerId
      });

      await evaluateAutoDownloadsForItem({
        tenantId: request.tenantId!,
        itemId,
        config
      });

      return match;
    }
  );

  app.get(
    "/api/items/:itemId/match/candidates",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { itemId } = parseParams(itemParamsSchema, request);
      return listMatchCandidates(request.tenantId!, itemId);
    }
  );

  app.post(
    "/api/items/:itemId/match/candidates/:candidateId/accept",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const params = parseParams(acceptCandidateParamsSchema, request);
      const media = await acceptCandidate({
        tenantId: request.tenantId!,
        itemId: params.itemId,
        candidateId: params.candidateId
      });

      await audit(request, "media_match.accept", "media", media.id, {
        itemId: params.itemId
      });

      await evaluateAutoDownloadsForItem({
        tenantId: request.tenantId!,
        itemId: params.itemId,
        config
      });

      return media;
    }
  );
}
