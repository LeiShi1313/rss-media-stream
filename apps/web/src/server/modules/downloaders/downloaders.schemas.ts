import { z } from "zod";

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value.length ? value : undefined))
  .optional();

const tagsSchema = z
  .array(z.string().trim().min(1).max(64))
  .max(20)
  .default([])
  .transform((tags) => [...new Set(tags)]);

export const downloaderTypeSchema = z.enum(["QBITTORRENT", "TRANSMISSION"]);

export const downloaderCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: downloaderTypeSchema,
  baseUrl: z.string().url(),
  username: optionalString,
  password: optionalString,
  defaultSavePath: optionalString,
  category: optionalString,
  tags: tagsSchema,
  enabled: z.boolean().default(true)
});

export const downloaderPatchSchema = downloaderCreateSchema
  .partial()
  .extend({ clearPassword: z.boolean().optional() })
  .refine((input) => !(input.password && input.clearPassword), {
    message: "password and clearPassword cannot both be set"
  });

export const downloaderConfigTestSchema = downloaderCreateSchema.extend({
  id: z.string().min(1).optional()
});

export const downloaderParamsSchema = z.object({
  id: z.string().min(1)
});

export const setDefaultDownloaderSchema = z.object({
  downloaderId: z.string().min(1).nullable()
});

export type DownloaderCreateInput = z.infer<typeof downloaderCreateSchema>;
export type DownloaderPatchInput = z.infer<typeof downloaderPatchSchema>;
export type DownloaderConfigTestInput = z.infer<typeof downloaderConfigTestSchema>;
