import type { DownloaderType } from "@prisma/client";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { createDownloaderClient } from "../../downloaders.js";
import { encryptSecret } from "../../secrets.js";
import { notFound } from "../../core/errors.js";
import type {
  DownloaderConfigTestInput,
  DownloaderCreateInput,
  DownloaderPatchInput
} from "./downloaders.schemas.js";

type DownloaderRecord = {
  id: string;
  name: string;
  type: DownloaderType;
  baseUrl: string;
  username: string | null;
  defaultSavePath: string | null;
  category: string | null;
  tags: string[] | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count?: { jobs: number };
};

export type DownloaderResponse = {
  id: string;
  name: string;
  type: DownloaderType;
  baseUrl: string;
  username: string | null;
  defaultSavePath: string | null;
  category: string | null;
  tags: string[];
  enabled: boolean;
  isDefault: boolean;
  jobCount?: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function listDownloaders(tenantId: string) {
  const [settings, downloaders] = await Promise.all([
    prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { defaultDownloaderId: true }
    }),
    prisma.downloader.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { jobs: true } } }
    })
  ]);

  return downloaders.map((downloader) =>
    serializeDownloader(downloader, settings?.defaultDownloaderId ?? null)
  );
}

export async function getDownloader(tenantId: string, downloaderId: string) {
  const [settings, downloader] = await Promise.all([
    prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { defaultDownloaderId: true }
    }),
    prisma.downloader.findFirst({
      where: { id: downloaderId, tenantId },
      include: { _count: { select: { jobs: true } } }
    })
  ]);

  if (!downloader) throw notFound("Downloader");
  return serializeDownloader(downloader, settings?.defaultDownloaderId ?? null);
}

export async function getDefaultDownloader(tenantId: string) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { defaultDownloaderId: true }
  });

  if (!settings?.defaultDownloaderId) return null;

  const downloader = await prisma.downloader.findFirst({
    where: { id: settings.defaultDownloaderId, tenantId },
    include: { _count: { select: { jobs: true } } }
  });

  return downloader ? serializeDownloader(downloader, settings.defaultDownloaderId) : null;
}

export async function createDownloader(
  input: DownloaderCreateInput,
  ctx: { tenantId: string; userId: string },
  config: AppConfig
) {
  return prisma.downloader.create({
    data: {
      tenantId: ctx.tenantId,
      createdByUserId: ctx.userId,
      name: input.name,
      type: input.type,
      baseUrl: input.baseUrl,
      username: input.username,
      encryptedPassword: input.password
        ? encryptSecret(input.password, config.appSecret)
        : undefined,
      defaultSavePath: input.defaultSavePath,
      category: input.category,
      tags: input.tags,
      enabled: input.enabled
    },
    select: { id: true }
  });
}

export async function updateDownloader(
  tenantId: string,
  downloaderId: string,
  input: DownloaderPatchInput,
  config: AppConfig
) {
  const existing = await prisma.downloader.findFirst({
    where: { id: downloaderId, tenantId },
    select: { id: true }
  });
  if (!existing) throw notFound("Downloader");

  const downloader = await prisma.downloader.update({
    where: { id_tenantId: { id: downloaderId, tenantId } },
    data: {
      name: input.name,
      type: input.type,
      baseUrl: input.baseUrl,
      username: input.username,
      encryptedPassword: input.clearPassword
        ? null
        : input.password
          ? encryptSecret(input.password, config.appSecret)
          : undefined,
      defaultSavePath: input.defaultSavePath,
      category: input.category,
      tags: input.tags,
      enabled: input.enabled
    },
    include: { _count: { select: { jobs: true } } }
  });

  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { defaultDownloaderId: true }
  });

  return serializeDownloader(downloader, settings?.defaultDownloaderId ?? null);
}

export async function deleteDownloader(tenantId: string, downloaderId: string) {
  return prisma.$transaction(async (tx) => {
    const downloader = await tx.downloader.findFirst({
      where: { id: downloaderId, tenantId },
      select: { id: true }
    });
    if (!downloader) throw notFound("Downloader");

    await tx.tenantSettings.updateMany({
      where: { tenantId, defaultDownloaderId: downloaderId },
      data: { defaultDownloaderId: null }
    });

    await tx.downloader.delete({
      where: { id_tenantId: { id: downloaderId, tenantId } }
    });

    return { id: downloaderId };
  });
}

export async function setDefaultDownloader(
  tenantId: string,
  downloaderId: string | null
) {
  if (downloaderId) {
    const downloader = await prisma.downloader.findFirst({
      where: { id: downloaderId, tenantId, enabled: true },
      select: { id: true }
    });
    if (!downloader) throw notFound("Downloader");
  }

  const settings = await prisma.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId, defaultDownloaderId: downloaderId },
    update: { defaultDownloaderId: downloaderId },
    select: { tenantId: true, defaultDownloaderId: true }
  });

  return settings;
}

export async function testDownloader(
  tenantId: string,
  downloaderId: string,
  config: AppConfig
) {
  const downloader = await prisma.downloader.findFirst({
    where: { id: downloaderId, tenantId }
  });
  if (!downloader) throw notFound("Downloader");

  return createDownloaderClient(downloader, config).test();
}

export async function testDownloaderConfig(
  tenantId: string,
  input: DownloaderConfigTestInput,
  config: AppConfig
) {
  const existing =
    input.id && !input.password
      ? await prisma.downloader.findFirst({
          where: { id: input.id, tenantId },
          select: { encryptedPassword: true }
        })
      : null;
  if (input.id && !input.password && !existing) throw notFound("Downloader");

  return createDownloaderClient(
    {
      type: input.type,
      baseUrl: input.baseUrl,
      username: input.username ?? null,
      encryptedPassword: input.password
        ? encryptSecret(input.password, config.appSecret)
        : existing?.encryptedPassword ?? null,
      defaultSavePath: input.defaultSavePath ?? null,
      category: input.category ?? null,
      tags: input.tags
    },
    config
  ).test();
}

export async function listDownloaderTorrents(
  tenantId: string,
  downloaderId: string,
  config: AppConfig
) {
  const downloader = await prisma.downloader.findFirst({
    where: { id: downloaderId, tenantId, enabled: true }
  });
  if (!downloader) throw notFound("Downloader");

  return createDownloaderClient(downloader, config).listTorrents();
}

function serializeDownloader(
  downloader: DownloaderRecord,
  defaultDownloaderId: string | null
): DownloaderResponse {
  return {
    id: downloader.id,
    name: downloader.name,
    type: downloader.type,
    baseUrl: downloader.baseUrl,
    username: downloader.username,
    defaultSavePath: downloader.defaultSavePath,
    category: downloader.category,
    tags: normalizeTags(downloader.tags),
    enabled: downloader.enabled,
    isDefault: defaultDownloaderId === downloader.id,
    jobCount: downloader._count?.jobs,
    createdAt: downloader.createdAt,
    updatedAt: downloader.updatedAt
  };
}

function normalizeTags(tags: string[] | null | undefined) {
  if (!tags) return [];
  return tags;
}
