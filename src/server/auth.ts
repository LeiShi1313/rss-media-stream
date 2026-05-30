import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { prisma } from "./db.js";
import { audit } from "./audit.js";

const setupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(10).max(200)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: "OWNER" | "ADMIN" | "VIEWER";
};

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}

export function registerAuthRoutes(app: FastifyInstance, config: AppConfig) {
  app.get("/api/setup/status", async () => {
    const count = await prisma.user.count();
    return { required: count === 0 };
  });

  app.post("/api/setup", async (request, reply) => {
    const existing = await prisma.user.count();
    if (existing > 0) {
      return reply.code(409).send({ message: "Setup has already been completed" });
    }
    const input = setupSchema.parse(request.body);
    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: await bcrypt.hash(input.password, 12),
        role: "OWNER"
      }
    });
    await audit(prisma, {
      userId: user.id,
      action: "setup.create_owner",
      entityType: "user",
      entityId: user.id
    });
    setSessionCookie(app, reply, config, user.id, user.role);
    return publicUser(user);
  });

  app.post("/api/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() }
    });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return reply.code(401).send({ message: "Invalid email or password" });
    }
    setSessionCookie(app, reply, config, user.id, user.role);
    return publicUser(user);
  });

  app.post("/api/logout", async (_request, reply) => {
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireUser }, async (request) => {
    return request.currentUser;
  });
}

export async function requireUser(request: FastifyRequest) {
  const token = await request.jwtVerify<{ sub: string; role: CurrentUser["role"] }>();
  const user = await prisma.user.findUnique({ where: { id: token.sub } });
  if (!user) {
    throw Object.assign(new Error("User not found"), { statusCode: 401 });
  }
  request.currentUser = publicUser(user);
}

export function requireAdmin(request: FastifyRequest) {
  if (!request.currentUser || !["OWNER", "ADMIN"].includes(request.currentUser.role)) {
    throw Object.assign(new Error("Admin access required"), { statusCode: 403 });
  }
}

function setSessionCookie(
  app: FastifyInstance,
  reply: FastifyReply,
  config: AppConfig,
  userId: string,
  role: string
) {
  const token = app.jwt.sign({ role }, { sub: userId, expiresIn: "14d" });
  reply.setCookie("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/"
  });
}

function publicUser(user: {
  id: string;
  email: string;
  name: string;
  role: "OWNER" | "ADMIN" | "VIEWER";
}): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  };
}
