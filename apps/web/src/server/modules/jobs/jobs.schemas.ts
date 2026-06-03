import { z } from "zod";

export const manualDownloadSchema = z.object({
  downloaderId: z.string().min(1).optional(),
  subscriptionId: z.string().min(1).optional(),
  forceDuplicate: z.boolean().default(false)
});

export const itemDownloadParamsSchema = z.object({
  itemId: z.string().min(1)
});

export const downloadJobParamsSchema = z.object({
  id: z.string().min(1)
});

export type ManualDownloadInput = z.infer<typeof manualDownloadSchema>;
