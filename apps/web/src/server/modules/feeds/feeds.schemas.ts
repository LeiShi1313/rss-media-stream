import { z } from "zod";

export const createFeedSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().url(),
  requestHeaders: z.object({
    cookie: z.string().trim().min(1).optional(),
    "user-agent": z.string().trim().min(1).optional()
  }).partial().optional(),
  pollIntervalSeconds: z.number().int().min(60).max(86400).default(600),
  enabled: z.boolean().default(true)
});

export const patchFeedSchema = createFeedSchema.partial();

export const feedParamsSchema = z.object({
  feedId: z.string().min(1)
});

export type CreateFeedInput = z.infer<typeof createFeedSchema>;
export type PatchFeedInput = z.infer<typeof patchFeedSchema>;
