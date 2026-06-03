import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { audit } from "../../core/audit.js";
import { requireTenantRole } from "../../core/permissions.js";
import { parseBody, parseParams } from "../../core/validation.js";
import {
  downloaderConfigTestSchema,
  downloaderCreateSchema,
  downloaderParamsSchema,
  downloaderPatchSchema,
  setDefaultDownloaderSchema
} from "./downloaders.schemas.js";
import {
  createDownloader,
  deleteDownloader,
  getDefaultDownloader,
  getDownloader,
  listDownloaderTorrents,
  listDownloaders,
  setDefaultDownloader,
  testDownloaderConfig,
  testDownloader,
  updateDownloader
} from "./downloaders.service.js";

export async function registerDownloaderRoutes(
  app: FastifyInstance,
  config: AppConfig
) {
  app.get(
    "/api/downloaders",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      return listDownloaders(request.tenantId!);
    }
  );

  app.get(
    "/api/downloaders/default",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      return getDefaultDownloader(request.tenantId!);
    }
  );

  app.put(
    "/api/downloaders/default",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const input = parseBody(setDefaultDownloaderSchema, request);
      const settings = await setDefaultDownloader(
        request.tenantId!,
        input.downloaderId
      );

      await audit(request, "downloader.default.update", "tenantSettings");
      return settings;
    }
  );

  app.get(
    "/api/downloaders/:id",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      const { id } = parseParams(downloaderParamsSchema, request);
      return getDownloader(request.tenantId!, id);
    }
  );

  app.post(
    "/api/downloaders",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const input = parseBody(downloaderCreateSchema, request);
      const downloader = await createDownloader(
        input,
        {
          tenantId: request.tenantId!,
          userId: request.currentUser!.id
        },
        config
      );

      await audit(request, "downloader.create", "downloader", downloader.id);
      return { id: downloader.id };
    }
  );

  app.post(
    "/api/downloaders/test",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const input = parseBody(downloaderConfigTestSchema, request);
      return testDownloaderConfig(request.tenantId!, input, config);
    }
  );

  app.patch(
    "/api/downloaders/:id",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const { id } = parseParams(downloaderParamsSchema, request);
      const input = parseBody(downloaderPatchSchema, request);
      const downloader = await updateDownloader(
        request.tenantId!,
        id,
        input,
        config
      );

      await audit(request, "downloader.update", "downloader", id);
      return downloader;
    }
  );

  app.delete(
    "/api/downloaders/:id",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const { id } = parseParams(downloaderParamsSchema, request);
      const result = await deleteDownloader(request.tenantId!, id);

      await audit(request, "downloader.delete", "downloader", id);
      return result;
    }
  );

  app.post(
    "/api/downloaders/:id/test",
    { preHandler: requireTenantRole("ADMIN") },
    async (request) => {
      const { id } = parseParams(downloaderParamsSchema, request);
      return testDownloader(request.tenantId!, id, config);
    }
  );

  app.get(
    "/api/downloaders/:id/torrents",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { id } = parseParams(downloaderParamsSchema, request);
      return listDownloaderTorrents(request.tenantId!, id, config);
    }
  );
}
