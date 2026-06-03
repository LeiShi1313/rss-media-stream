import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { requireTenantRole } from "../../core/permissions.js";
import { parseParams, parseQuery } from "../../core/validation.js";
import { listMatchCandidates } from "../media/media.service.js";
import { getItem, listItems } from "./items.service.js";
import { itemParamsSchema, itemQuerySchema } from "./items.schemas.js";

export async function registerItemRoutes(
  app: FastifyInstance,
  _config: AppConfig
) {
  app.get(
    "/api/items",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      const query = parseQuery(itemQuerySchema, request);
      return listItems(request.tenantId!, query);
    }
  );

  app.get(
    "/api/items/:itemId",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      const params = parseParams(itemParamsSchema, request);
      return getItem(request.tenantId!, params.itemId);
    }
  );

  app.get(
    "/api/items/:itemId/match-candidates",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const params = parseParams(itemParamsSchema, request);
      return listMatchCandidates(request.tenantId!, params.itemId);
    }
  );
}
