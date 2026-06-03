import { ZodError } from "zod";
import type { FastifyError, FastifyInstance } from "fastify";

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message = "Bad request", details?: unknown) {
  return new AppError(400, "BAD_REQUEST", message, details);
}

export function unauthorized(message = "Authentication required") {
  return new AppError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Permission denied") {
  return new AppError(403, "FORBIDDEN", message);
}

export function notFound(entity = "Resource") {
  return new AppError(404, "NOT_FOUND", `${entity} not found`);
}

export function conflict(code: string, message: string, details?: unknown) {
  return new AppError(409, code, message, details);
}

export function badGateway(message = "Upstream service failed", details?: unknown) {
  return new AppError(502, "BAD_GATEWAY", message, details);
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "Validation failed",
        issues: error.issues
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details
      });
    }

    const fastifyError = error as FastifyError;
    if (typeof fastifyError.statusCode === "number") {
      return reply.code(fastifyError.statusCode).send({
        code: fastifyError.code ?? "REQUEST_FAILED",
        message: fastifyError.message
      });
    }

    app.log.error(error);
    return reply.code(500).send({
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error"
    });
  });
}
