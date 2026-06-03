import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { audit } from "../../core/audit.js";
import { requireTenantRole } from "../../core/permissions.js";
import { parseBody, parseParams } from "../../core/validation.js";
import {
  downloadJobParamsSchema,
  itemDownloadParamsSchema,
  manualDownloadSchema
} from "./jobs.schemas.js";
import {
  createDownloadJob,
  getDownloadJob,
  listDownloadJobs,
  retryDownloadJob,
  sendDownloadJob,
  skipDownloadJob
} from "./jobs.service.js";

export async function registerJobRoutes(app: FastifyInstance, config: AppConfig) {
  app.post(
    "/api/items/:itemId/downloads",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { itemId } = parseParams(itemDownloadParamsSchema, request);
      const input = parseBody(manualDownloadSchema, request);

      const job = await createDownloadJob({
        tenantId: request.tenantId!,
        itemId,
        downloaderId: input.downloaderId,
        subscriptionId: input.subscriptionId,
        createdByUserId: request.currentUser!.id,
        source: "MANUAL",
        forceDuplicate: input.forceDuplicate
      });

      await audit(request, "download.create", "downloadJob", job.id, {
        itemId,
        downloaderId: job.downloaderId
      });

      return sendDownloadJob(job.id, config);
    }
  );

  app.get(
    "/api/download-jobs",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      return listDownloadJobs(request.tenantId!);
    }
  );

  app.get(
    "/api/download-jobs/:id",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { id } = parseParams(downloadJobParamsSchema, request);
      return getDownloadJob(request.tenantId!, id);
    }
  );

  app.post(
    "/api/download-jobs/:id/retry",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { id } = parseParams(downloadJobParamsSchema, request);
      const job = await retryDownloadJob(
        id,
        {
          tenantId: request.tenantId!,
          userId: request.currentUser!.id,
          role: request.currentMembership!.role
        },
        config
      );

      await audit(request, "download.retry", "downloadJob", id);
      return job;
    }
  );

  app.post(
    "/api/download-jobs/:id/skip",
    { preHandler: requireTenantRole("MEMBER") },
    async (request) => {
      const { id } = parseParams(downloadJobParamsSchema, request);
      const job = await skipDownloadJob(id, {
        tenantId: request.tenantId!,
        userId: request.currentUser!.id,
        role: request.currentMembership!.role
      });

      await audit(request, "download.skip", "downloadJob", id);
      return job;
    }
  );
}
