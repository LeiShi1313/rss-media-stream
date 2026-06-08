import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { getDefaultPoliciesForMediaType, listProviderDefinitions } from "../src/server/integrations/providers/index.js";
import { encryptSecret, hmacSecret } from "../src/server/secrets.js";

const prisma = new PrismaClient();

type SeedFeed = {
  name: string;
  url: string;
  pollIntervalSeconds?: number;
  enabled?: boolean;
};

async function main() {
  const seedEmail = (process.env.SEED_USER_EMAIL ?? "me@leishi.xyz").toLowerCase();
  const seedPassword = process.env.SEED_USER_PASSWORD ?? "password12345";
  const seedName = process.env.SEED_USER_NAME ?? "Lei";
  const seedWorkspace = process.env.SEED_WORKSPACE_NAME ?? "RSS Media Stream";
  const appSecret = process.env.APP_SECRET ?? "dev-app-secret-change-me-please-32chars";

  const user = await prisma.user.upsert({
    where: { email: seedEmail },
    create: {
      email: seedEmail,
      name: seedName,
      passwordHash: await bcrypt.hash(seedPassword, 12)
    },
    update: {
      name: seedName,
      passwordHash: await bcrypt.hash(seedPassword, 12)
    },
    select: { id: true }
  });

  const existingMembership = await prisma.tenantMembership.findFirst({
    where: { userId: user.id },
    select: { tenantId: true }
  });

  const tenantId = existingMembership?.tenantId ?? (await prisma.tenant.create({
    data: {
      name: seedWorkspace,
      memberships: {
        create: {
          userId: user.id,
          role: "OWNER"
        }
      },
      settings: {
        create: {}
      }
    },
    select: { id: true }
  })).id;

  await prisma.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId },
    update: {}
  });

  const tenants = await prisma.tenant.findMany({ select: { id: true } });

  for (const tenant of tenants) {
    for (const definition of listProviderDefinitions()) {
      const secrets = providerSecretsFromEnv(definition.id);
      await prisma.tenantProviderConfig.upsert({
        where: { tenantId_provider: { tenantId: tenant.id, provider: definition.id } },
        create: {
          tenantId: tenant.id,
          provider: definition.id,
          enabled: true,
          encryptedSecretsJson: secrets ? encryptSecret(JSON.stringify(secrets), appSecret) : undefined,
          configuredAt: secrets ? new Date() : undefined,
          lastValidatedAt: secrets ? new Date() : undefined,
          metadataLanguage: definition.defaultMetadataLanguage
        },
        update: secrets
          ? {
              encryptedSecretsJson: encryptSecret(JSON.stringify(secrets), appSecret),
              configuredAt: new Date(),
              lastValidatedAt: new Date(),
              lastError: null
            }
          : {}
      });
    }

    for (const mediaType of ["MOVIE", "TV_SERIES"] as const) {
      for (const policy of getDefaultPoliciesForMediaType(mediaType)) {
        await prisma.tenantMediaProviderPolicy.upsert({
          where: {
            tenantId_mediaType_provider: {
              tenantId: tenant.id,
              mediaType,
              provider: policy.provider
            }
          },
          create: {
            tenantId: tenant.id,
            mediaType,
            provider: policy.provider,
            enabledForMatching: policy.enabledForMatching,
            enabledForPresentation: policy.enabledForPresentation,
            matchingPriority: policy.matchingPriority,
            presentationPriority: policy.presentationPriority
          },
          update: {}
        });
      }
    }

    for (const feed of seedFeedsFromEnv()) {
      const urlHash = hmacSecret(feed.url, appSecret);
      const existing = await prisma.rssFeed.findFirst({
        where: { tenantId: tenant.id, urlHash },
        select: { id: true }
      });
      const data = {
        name: feed.name,
        encryptedUrl: encryptSecret(feed.url, appSecret),
        urlHash,
        pollIntervalSeconds: feed.pollIntervalSeconds ?? 600,
        enabled: feed.enabled ?? true
      };

      if (existing) {
        await prisma.rssFeed.update({
          where: { id_tenantId: { id: existing.id, tenantId: tenant.id } },
          data
        });
      } else {
        await prisma.rssFeed.create({
          data: {
            ...data,
            tenantId: tenant.id,
            createdByUserId: user.id
          }
        });
      }
    }
  }
}

function providerSecretsFromEnv(provider: string) {
  if (provider === "tmdb") {
    const apiKey = process.env.TMDB_API_KEY?.trim();
    return apiKey ? { apiKey } : undefined;
  }

  if (provider === "tvdb") {
    const apiKey = process.env.TVDB_API_KEY?.trim();
    const pin = process.env.TVDB_PIN?.trim();
    return apiKey ? { apiKey, ...(pin ? { pin } : {}) } : undefined;
  }

  return undefined;
}

function seedFeedsFromEnv(): SeedFeed[] {
  const json = process.env.SEED_RSS_FEEDS_JSON?.trim();
  if (json) {
    const parsed = JSON.parse(json) as SeedFeed[];
    if (!Array.isArray(parsed)) {
      throw new Error("SEED_RSS_FEEDS_JSON must be a JSON array");
    }
    return parsed.map(normalizeSeedFeed);
  }

  const compact = process.env.SEED_RSS_FEEDS?.trim();
  if (!compact) return [];

  return compact
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const [name, url, pollIntervalSeconds, enabled] = entry.split("|").map((part) => part.trim());
      return normalizeSeedFeed({
        name: name || `RSS Feed ${index + 1}`,
        url,
        pollIntervalSeconds: pollIntervalSeconds ? Number(pollIntervalSeconds) : undefined,
        enabled: enabled ? enabled.toLowerCase() !== "false" : undefined
      });
    });
}

function normalizeSeedFeed(feed: SeedFeed): SeedFeed {
  const name = feed.name?.trim();
  const url = feed.url?.trim();
  if (!name) throw new Error("Seed RSS feed name is required");
  if (!url) throw new Error(`Seed RSS feed URL is required for ${name}`);
  new URL(url);

  const pollIntervalSeconds = feed.pollIntervalSeconds ?? 600;
  if (!Number.isInteger(pollIntervalSeconds) || pollIntervalSeconds < 60 || pollIntervalSeconds > 86400) {
    throw new Error(`Seed RSS feed ${name} has an invalid pollIntervalSeconds`);
  }

  return {
    name,
    url,
    pollIntervalSeconds,
    enabled: feed.enabled ?? true
  };
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
