import type { FastifyRequest } from "fastify";
import type { z } from "zod";

export function parseBody<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  request: FastifyRequest
): z.infer<TSchema> {
  return schema.parse(request.body);
}

export function parseParams<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  request: FastifyRequest
): z.infer<TSchema> {
  return schema.parse(request.params);
}

export function parseQuery<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  request: FastifyRequest
): z.infer<TSchema> {
  return schema.parse(request.query);
}
