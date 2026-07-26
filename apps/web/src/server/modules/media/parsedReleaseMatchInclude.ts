import type { Prisma } from "@prisma/client";

export const parsedReleaseMatchInclude = {
  mediaTitle: {
    include: { providerIdentities: { include: { metadata: true } } }
  },
  mediaProviderIdentity: true,
  providerMediaMetadata: { include: { mediaProviderIdentity: true } },
  providerTitle: true
} satisfies Prisma.ParsedReleaseMatchInclude;

export type ActiveParsedReleaseMatch = Prisma.ParsedReleaseMatchGetPayload<{
  include: typeof parsedReleaseMatchInclude;
}>;
