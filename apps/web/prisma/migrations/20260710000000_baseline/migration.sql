-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('MOVIE', 'TV_SERIES', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ParseStatus" AS ENUM ('PENDING', 'PARSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ParsedReleaseMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ParsedReleaseMatchSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "MediaTitleProviderLinkSource" AS ENUM ('MANUAL', 'PROVIDER_CROSSREF', 'SEARCH_MATCH', 'IMPORT');

-- CreateEnum
CREATE TYPE "MediaProviderIdentityLinkSource" AS ENUM ('MANUAL', 'PROVIDER_CROSSREF', 'SEARCH_MATCH', 'IMPORT');

-- CreateEnum
CREATE TYPE "ProviderRatingType" AS ENUM ('USER_SCORE', 'CRITIC_SCORE', 'POPULARITY');

-- CreateEnum
CREATE TYPE "DownloaderType" AS ENUM ('QBITTORRENT', 'TRANSMISSION');

-- CreateEnum
CREATE TYPE "DownloadStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DOWNLOADING', 'COMPLETE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DownloadSource" AS ENUM ('MANUAL', 'SUBSCRIPTION', 'RETRY');

-- CreateEnum
CREATE TYPE "DedupeKeyType" AS ENUM ('INFO_HASH', 'RELEASE_SIGNATURE', 'LINK_HASH');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSettings" (
    "tenantId" TEXT NOT NULL,
    "defaultDownloaderId" TEXT,
    "webLanguage" TEXT NOT NULL DEFAULT 'en-US',

    CONSTRAINT "TenantSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "TenantProviderConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "encryptedSecretsJson" TEXT,
    "configuredAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadataLanguage" TEXT,
    "region" TEXT,
    "baseUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMediaProviderPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "provider" TEXT NOT NULL,
    "enabledForMatching" BOOLEAN NOT NULL DEFAULT true,
    "enabledForPresentation" BOOLEAN NOT NULL DEFAULT true,
    "matchingPriority" INTEGER NOT NULL,
    "presentationPriority" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMediaProviderPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantProviderSourceConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerSource" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "encryptedSecretsJson" TEXT,
    "configuredAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadataLanguage" TEXT,
    "region" TEXT,
    "baseUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantProviderSourceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantProviderSourcePolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "providerSource" TEXT NOT NULL,
    "enabledForMatching" BOOLEAN NOT NULL DEFAULT true,
    "enabledForPresentation" BOOLEAN NOT NULL DEFAULT true,
    "matchingPriority" INTEGER NOT NULL,
    "presentationPriority" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantProviderSourcePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RssFeed" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedUrl" TEXT,
    "urlHash" TEXT,
    "encryptedRequestHeadersJson" TEXT,
    "pollIntervalSeconds" INTEGER NOT NULL DEFAULT 600,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastPolledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RssFeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RssItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "infoHash" TEXT,
    "guidHash" TEXT,
    "linkHash" TEXT,
    "dedupeKeyType" "DedupeKeyType" NOT NULL,
    "dedupeKeyHash" TEXT NOT NULL,
    "releaseSignature" TEXT,
    "rawTitle" TEXT NOT NULL,
    "encryptedTorrentUrl" TEXT NOT NULL,
    "encryptedSourceUrl" TEXT,
    "publishDate" TIMESTAMP(3),
    "sizeBytes" BIGINT,
    "rawJsonEncrypted" TEXT,
    "rawJsonRedacted" JSONB,
    "parseStatus" "ParseStatus" NOT NULL DEFAULT 'PENDING',
    "parseConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RssItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParsedRelease" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rssItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "providerSearchTitles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "year" INTEGER,
    "mediaType" "MediaType" NOT NULL DEFAULT 'UNKNOWN',
    "season" INTEGER,
    "episode" INTEGER,
    "episodeEnd" INTEGER,
    "resolution" INTEGER,
    "quality" TEXT,
    "source" TEXT,
    "codec" TEXT,
    "audio" TEXT,
    "releaseGroup" TEXT,
    "parseConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "parsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParsedRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaTitle" (
    "id" TEXT NOT NULL,
    "supersededById" TEXT,
    "mediaType" "MediaType" NOT NULL,
    "canonicalTitle" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "originalTitle" TEXT,
    "releaseYear" INTEGER,
    "endYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaTitleMerge" (
    "id" TEXT NOT NULL,
    "sourceMediaTitleId" TEXT NOT NULL,
    "targetMediaTitleId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mergedBy" TEXT,
    "algorithmVersion" TEXT,

    CONSTRAINT "MediaTitleMerge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaProviderIdentity" (
    "id" TEXT NOT NULL,
    "mediaTitleId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "linkConfidence" DOUBLE PRECISION NOT NULL,
    "linkSource" "MediaProviderIdentityLinkSource" NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaProviderIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderMediaMetadata" (
    "id" TEXT NOT NULL,
    "mediaProviderIdentityId" TEXT NOT NULL,
    "providerSource" TEXT NOT NULL,
    "localeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT,
    "titleAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "titleKey" TEXT NOT NULL,
    "releaseYear" INTEGER,
    "endYear" INTEGER,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "ratingValue" DOUBLE PRECISION,
    "ratingScale" DOUBLE PRECISION,
    "ratingVoteCount" INTEGER,
    "ratingType" "ProviderRatingType",
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderMediaMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderTitle" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEntityType" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "originalTitle" TEXT,
    "releaseYear" INTEGER,
    "endYear" INTEGER,
    "language" TEXT,
    "region" TEXT,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "ratingValue" DOUBLE PRECISION,
    "ratingScale" DOUBLE PRECISION,
    "ratingVoteCount" INTEGER,
    "ratingType" "ProviderRatingType",
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaTitleProviderLink" (
    "id" TEXT NOT NULL,
    "mediaTitleId" TEXT NOT NULL,
    "providerTitleId" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" "MediaTitleProviderLinkSource" NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaTitleProviderLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParsedReleaseMatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parsedReleaseId" TEXT NOT NULL,
    "mediaTitleId" TEXT,
    "providerTitleId" TEXT,
    "mediaProviderIdentityId" TEXT,
    "providerMediaMetadataId" TEXT,
    "mediaType" "MediaType",
    "status" "ParsedReleaseMatchStatus" NOT NULL,
    "source" "ParsedReleaseMatchSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "matchedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "replacedByMatchId" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "staleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParsedReleaseMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Downloader" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DownloaderType" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "username" TEXT,
    "encryptedPassword" TEXT,
    "defaultSavePath" TEXT,
    "category" TEXT,
    "tags" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Downloader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "downloaderId" TEXT,
    "mediaTitleId" TEXT,
    "title" TEXT NOT NULL,
    "autoDownload" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "mediaType" "MediaType",
    "provider" TEXT,
    "providerEntityType" TEXT,
    "providerId" TEXT,
    "imdbId" TEXT,
    "doubanId" TEXT,
    "titleRegex" TEXT,
    "includeRegex" TEXT,
    "excludeRegex" TEXT,
    "minResolution" INTEGER,
    "maxResolution" INTEGER,
    "sources" TEXT[],
    "codecs" TEXT[],
    "audio" TEXT[],
    "releaseGroupsInclude" TEXT[],
    "releaseGroupsExclude" TEXT[],
    "minSizeBytes" BIGINT,
    "maxSizeBytes" BIGINT,
    "season" INTEGER,
    "episodeStart" INTEGER,
    "episodeEnd" INTEGER,
    "criteriaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionMatchDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "ruleSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionMatchDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "downloaderId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "source" "DownloadSource" NOT NULL,
    "status" "DownloadStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupeKey" TEXT,
    "infoHash" TEXT,
    "clientHash" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DownloadJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantSettings_defaultDownloaderId_idx" ON "TenantSettings"("defaultDownloaderId");

-- CreateIndex
CREATE INDEX "TenantProviderConfig_tenantId_idx" ON "TenantProviderConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantProviderConfig_tenantId_provider_key" ON "TenantProviderConfig"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "TenantMediaProviderPolicy_tenantId_mediaType_idx" ON "TenantMediaProviderPolicy"("tenantId", "mediaType");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMediaProviderPolicy_tenantId_mediaType_provider_key" ON "TenantMediaProviderPolicy"("tenantId", "mediaType", "provider");

-- CreateIndex
CREATE INDEX "TenantProviderSourceConfig_tenantId_idx" ON "TenantProviderSourceConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantProviderSourceConfig_tenantId_providerSource_key" ON "TenantProviderSourceConfig"("tenantId", "providerSource");

-- CreateIndex
CREATE INDEX "TenantProviderSourcePolicy_tenantId_mediaType_idx" ON "TenantProviderSourcePolicy"("tenantId", "mediaType");

-- CreateIndex
CREATE UNIQUE INDEX "TenantProviderSourcePolicy_tenantId_mediaType_providerSourc_key" ON "TenantProviderSourcePolicy"("tenantId", "mediaType", "providerSource");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "TenantMembership_userId_idx" ON "TenantMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_tenantId_userId_key" ON "TenantMembership"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "RssFeed_tenantId_enabled_idx" ON "RssFeed"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "RssFeed_tenantId_createdAt_idx" ON "RssFeed"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "RssFeed_urlHash_idx" ON "RssFeed"("urlHash");

-- CreateIndex
CREATE UNIQUE INDEX "RssFeed_id_tenantId_key" ON "RssFeed"("id", "tenantId");

-- CreateIndex
CREATE INDEX "RssItem_tenantId_firstSeenAt_idx" ON "RssItem"("tenantId", "firstSeenAt");

-- CreateIndex
CREATE INDEX "RssItem_tenantId_parseStatus_idx" ON "RssItem"("tenantId", "parseStatus");

-- CreateIndex
CREATE INDEX "RssItem_tenantId_releaseSignature_idx" ON "RssItem"("tenantId", "releaseSignature");

-- CreateIndex
CREATE INDEX "RssItem_tenantId_infoHash_idx" ON "RssItem"("tenantId", "infoHash");

-- CreateIndex
CREATE UNIQUE INDEX "RssItem_id_tenantId_key" ON "RssItem"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RssItem_feedId_dedupeKeyType_dedupeKeyHash_key" ON "RssItem"("feedId", "dedupeKeyType", "dedupeKeyHash");

-- CreateIndex
CREATE INDEX "ParsedRelease_tenantId_mediaType_year_idx" ON "ParsedRelease"("tenantId", "mediaType", "year");

-- CreateIndex
CREATE INDEX "ParsedRelease_tenantId_title_idx" ON "ParsedRelease"("tenantId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "ParsedRelease_rssItemId_tenantId_key" ON "ParsedRelease"("rssItemId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ParsedRelease_id_tenantId_key" ON "ParsedRelease"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MediaTitle_mediaType_normalizedTitle_idx" ON "MediaTitle"("mediaType", "normalizedTitle");

-- CreateIndex
CREATE INDEX "MediaTitle_supersededById_idx" ON "MediaTitle"("supersededById");

-- CreateIndex
CREATE UNIQUE INDEX "MediaTitle_id_mediaType_key" ON "MediaTitle"("id", "mediaType");

-- CreateIndex
CREATE INDEX "MediaTitleMerge_targetMediaTitleId_idx" ON "MediaTitleMerge"("targetMediaTitleId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaTitleMerge_sourceMediaTitleId_targetMediaTitleId_key" ON "MediaTitleMerge"("sourceMediaTitleId", "targetMediaTitleId");

-- CreateIndex
CREATE INDEX "MediaProviderIdentity_mediaTitleId_idx" ON "MediaProviderIdentity"("mediaTitleId");

-- CreateIndex
CREATE INDEX "MediaProviderIdentity_provider_mediaType_idx" ON "MediaProviderIdentity"("provider", "mediaType");

-- CreateIndex
CREATE UNIQUE INDEX "MediaProviderIdentity_provider_providerId_mediaType_key" ON "MediaProviderIdentity"("provider", "providerId", "mediaType");

-- CreateIndex
CREATE INDEX "ProviderMediaMetadata_providerSource_titleKey_releaseYear_idx" ON "ProviderMediaMetadata"("providerSource", "titleKey", "releaseYear");

-- CreateIndex
CREATE INDEX "ProviderMediaMetadata_mediaProviderIdentityId_idx" ON "ProviderMediaMetadata"("mediaProviderIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderMediaMetadata_mediaProviderIdentityId_providerSourc_key" ON "ProviderMediaMetadata"("mediaProviderIdentityId", "providerSource", "localeKey");

-- CreateIndex
CREATE INDEX "ProviderTitle_provider_mediaType_normalizedTitle_releaseYea_idx" ON "ProviderTitle"("provider", "mediaType", "normalizedTitle", "releaseYear");

-- CreateIndex
CREATE INDEX "ProviderTitle_provider_ratingType_ratingValue_idx" ON "ProviderTitle"("provider", "ratingType", "ratingValue");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderTitle_provider_providerEntityType_providerId_key" ON "ProviderTitle"("provider", "providerEntityType", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderTitle_id_mediaType_key" ON "ProviderTitle"("id", "mediaType");

-- CreateIndex
CREATE UNIQUE INDEX "MediaTitleProviderLink_providerTitleId_key" ON "MediaTitleProviderLink"("providerTitleId");

-- CreateIndex
CREATE INDEX "MediaTitleProviderLink_mediaTitleId_idx" ON "MediaTitleProviderLink"("mediaTitleId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaTitleProviderLink_mediaTitleId_providerTitleId_key" ON "MediaTitleProviderLink"("mediaTitleId", "providerTitleId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaTitleProviderLink_providerTitleId_mediaType_key" ON "MediaTitleProviderLink"("providerTitleId", "mediaType");

-- CreateIndex
CREATE INDEX "ParsedReleaseMatch_tenantId_parsedReleaseId_status_invalida_idx" ON "ParsedReleaseMatch"("tenantId", "parsedReleaseId", "status", "invalidatedAt");

-- CreateIndex
CREATE INDEX "ParsedReleaseMatch_tenantId_mediaTitleId_status_idx" ON "ParsedReleaseMatch"("tenantId", "mediaTitleId", "status");

-- CreateIndex
CREATE INDEX "ParsedReleaseMatch_tenantId_providerTitleId_idx" ON "ParsedReleaseMatch"("tenantId", "providerTitleId");

-- CreateIndex
CREATE INDEX "ParsedReleaseMatch_tenantId_mediaProviderIdentityId_idx" ON "ParsedReleaseMatch"("tenantId", "mediaProviderIdentityId");

-- CreateIndex
CREATE INDEX "ParsedReleaseMatch_tenantId_providerMediaMetadataId_idx" ON "ParsedReleaseMatch"("tenantId", "providerMediaMetadataId");

-- CreateIndex
CREATE UNIQUE INDEX "ParsedReleaseMatch_id_tenantId_key" ON "ParsedReleaseMatch"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Downloader_tenantId_enabled_idx" ON "Downloader"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Downloader_id_tenantId_key" ON "Downloader"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Subscription_tenantId_createdByUserId_idx" ON "Subscription"("tenantId", "createdByUserId");

-- CreateIndex
CREATE INDEX "Subscription_tenantId_enabled_idx" ON "Subscription"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "Subscription_tenantId_mediaTitleId_idx" ON "Subscription"("tenantId", "mediaTitleId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_id_tenantId_key" ON "Subscription"("id", "tenantId");

-- CreateIndex
CREATE INDEX "SubscriptionRule_tenantId_subscriptionId_idx" ON "SubscriptionRule"("tenantId", "subscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionRule_tenantId_provider_providerEntityType_provi_idx" ON "SubscriptionRule"("tenantId", "provider", "providerEntityType", "providerId");

-- CreateIndex
CREATE INDEX "SubscriptionRule_tenantId_provider_providerId_idx" ON "SubscriptionRule"("tenantId", "provider", "providerId");

-- CreateIndex
CREATE INDEX "SubscriptionRule_tenantId_imdbId_idx" ON "SubscriptionRule"("tenantId", "imdbId");

-- CreateIndex
CREATE INDEX "SubscriptionRule_tenantId_doubanId_idx" ON "SubscriptionRule"("tenantId", "doubanId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionRule_subscriptionId_tenantId_key" ON "SubscriptionRule"("subscriptionId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionRule_id_tenantId_key" ON "SubscriptionRule"("id", "tenantId");

-- CreateIndex
CREATE INDEX "SubscriptionMatchDecision_tenantId_subscriptionId_createdAt_idx" ON "SubscriptionMatchDecision"("tenantId", "subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionMatchDecision_tenantId_itemId_idx" ON "SubscriptionMatchDecision"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "SubscriptionMatchDecision_tenantId_accepted_idx" ON "SubscriptionMatchDecision"("tenantId", "accepted");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionMatchDecision_id_tenantId_key" ON "SubscriptionMatchDecision"("id", "tenantId");

-- CreateIndex
CREATE INDEX "DownloadJob_tenantId_status_idx" ON "DownloadJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DownloadJob_tenantId_downloaderId_idx" ON "DownloadJob"("tenantId", "downloaderId");

-- CreateIndex
CREATE INDEX "DownloadJob_tenantId_subscriptionId_idx" ON "DownloadJob"("tenantId", "subscriptionId");

-- CreateIndex
CREATE INDEX "DownloadJob_tenantId_infoHash_idx" ON "DownloadJob"("tenantId", "infoHash");

-- CreateIndex
CREATE UNIQUE INDEX "DownloadJob_id_tenantId_key" ON "DownloadJob"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DownloadJob_tenantId_dedupeKey_key" ON "DownloadJob"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_userId_idx" ON "AuditLog"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_id_tenantId_key" ON "AuditLog"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "TenantSettings" ADD CONSTRAINT "TenantSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantProviderConfig" ADD CONSTRAINT "TenantProviderConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMediaProviderPolicy" ADD CONSTRAINT "TenantMediaProviderPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantProviderSourceConfig" ADD CONSTRAINT "TenantProviderSourceConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantProviderSourcePolicy" ADD CONSTRAINT "TenantProviderSourcePolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RssFeed" ADD CONSTRAINT "RssFeed_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RssFeed" ADD CONSTRAINT "RssFeed_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RssItem" ADD CONSTRAINT "RssItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RssItem" ADD CONSTRAINT "RssItem_feedId_tenantId_fkey" FOREIGN KEY ("feedId", "tenantId") REFERENCES "RssFeed"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedRelease" ADD CONSTRAINT "ParsedRelease_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedRelease" ADD CONSTRAINT "ParsedRelease_rssItemId_tenantId_fkey" FOREIGN KEY ("rssItemId", "tenantId") REFERENCES "RssItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaTitle" ADD CONSTRAINT "MediaTitle_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "MediaTitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaTitleMerge" ADD CONSTRAINT "MediaTitleMerge_sourceMediaTitleId_fkey" FOREIGN KEY ("sourceMediaTitleId") REFERENCES "MediaTitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaTitleMerge" ADD CONSTRAINT "MediaTitleMerge_targetMediaTitleId_fkey" FOREIGN KEY ("targetMediaTitleId") REFERENCES "MediaTitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaProviderIdentity" ADD CONSTRAINT "MediaProviderIdentity_mediaTitleId_fkey" FOREIGN KEY ("mediaTitleId") REFERENCES "MediaTitle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderMediaMetadata" ADD CONSTRAINT "ProviderMediaMetadata_mediaProviderIdentityId_fkey" FOREIGN KEY ("mediaProviderIdentityId") REFERENCES "MediaProviderIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaTitleProviderLink" ADD CONSTRAINT "MediaTitleProviderLink_mediaTitleId_mediaType_fkey" FOREIGN KEY ("mediaTitleId", "mediaType") REFERENCES "MediaTitle"("id", "mediaType") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaTitleProviderLink" ADD CONSTRAINT "MediaTitleProviderLink_providerTitleId_mediaType_fkey" FOREIGN KEY ("providerTitleId", "mediaType") REFERENCES "ProviderTitle"("id", "mediaType") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedReleaseMatch" ADD CONSTRAINT "ParsedReleaseMatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedReleaseMatch" ADD CONSTRAINT "ParsedReleaseMatch_parsedReleaseId_tenantId_fkey" FOREIGN KEY ("parsedReleaseId", "tenantId") REFERENCES "ParsedRelease"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedReleaseMatch" ADD CONSTRAINT "ParsedReleaseMatch_mediaTitleId_fkey" FOREIGN KEY ("mediaTitleId") REFERENCES "MediaTitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedReleaseMatch" ADD CONSTRAINT "ParsedReleaseMatch_providerTitleId_fkey" FOREIGN KEY ("providerTitleId") REFERENCES "ProviderTitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedReleaseMatch" ADD CONSTRAINT "ParsedReleaseMatch_mediaProviderIdentityId_fkey" FOREIGN KEY ("mediaProviderIdentityId") REFERENCES "MediaProviderIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedReleaseMatch" ADD CONSTRAINT "ParsedReleaseMatch_providerMediaMetadataId_fkey" FOREIGN KEY ("providerMediaMetadataId") REFERENCES "ProviderMediaMetadata"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedReleaseMatch" ADD CONSTRAINT "ParsedReleaseMatch_replacedByMatchId_fkey" FOREIGN KEY ("replacedByMatchId") REFERENCES "ParsedReleaseMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Downloader" ADD CONSTRAINT "Downloader_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Downloader" ADD CONSTRAINT "Downloader_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_downloaderId_tenantId_fkey" FOREIGN KEY ("downloaderId", "tenantId") REFERENCES "Downloader"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_mediaTitleId_fkey" FOREIGN KEY ("mediaTitleId") REFERENCES "MediaTitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionRule" ADD CONSTRAINT "SubscriptionRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionRule" ADD CONSTRAINT "SubscriptionRule_subscriptionId_tenantId_fkey" FOREIGN KEY ("subscriptionId", "tenantId") REFERENCES "Subscription"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionMatchDecision" ADD CONSTRAINT "SubscriptionMatchDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionMatchDecision" ADD CONSTRAINT "SubscriptionMatchDecision_subscriptionId_tenantId_fkey" FOREIGN KEY ("subscriptionId", "tenantId") REFERENCES "Subscription"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionMatchDecision" ADD CONSTRAINT "SubscriptionMatchDecision_itemId_tenantId_fkey" FOREIGN KEY ("itemId", "tenantId") REFERENCES "RssItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadJob" ADD CONSTRAINT "DownloadJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadJob" ADD CONSTRAINT "DownloadJob_itemId_tenantId_fkey" FOREIGN KEY ("itemId", "tenantId") REFERENCES "RssItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadJob" ADD CONSTRAINT "DownloadJob_subscriptionId_tenantId_fkey" FOREIGN KEY ("subscriptionId", "tenantId") REFERENCES "Subscription"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadJob" ADD CONSTRAINT "DownloadJob_downloaderId_tenantId_fkey" FOREIGN KEY ("downloaderId", "tenantId") REFERENCES "Downloader"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadJob" ADD CONSTRAINT "DownloadJob_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
