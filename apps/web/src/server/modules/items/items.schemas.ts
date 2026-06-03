import { z } from "zod";

export const itemParamsSchema = z.object({
  itemId: z.string().min(1)
});

export const itemQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
  feedId: z.string().min(1).optional(),
  unmatched: z.coerce.boolean().optional(),
  q: z.string().trim().min(1).optional()
});

export type ItemQueryInput = z.infer<typeof itemQuerySchema>;
