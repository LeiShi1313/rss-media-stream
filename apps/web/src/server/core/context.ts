import type { FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { conflict, unauthorized } from "./errors.js";

export type TenantRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
};

export type CurrentMembership = {
  tenantId: string;
  tenantName: string;
  role: TenantRole;
};

export type SessionPayload = {
  sub: string;
  activeTenantId?: string;
};

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: CurrentUser;
    currentMembership?: CurrentMembership;
    tenantId?: string;
  }
}

export async function authenticateUser(request: FastifyRequest) {
  if (request.currentUser) return request.currentUser;

  let token: SessionPayload;
  try {
    token = await request.jwtVerify<SessionPayload>();
  } catch {
    throw unauthorized();
  }

  const user = await prisma.user.findUnique({
    where: { id: token.sub },
    select: { id: true, email: true, name: true }
  });
  if (!user) throw unauthorized("User not found");

  request.currentUser = user;
  return user;
}

export async function resolveTenantContext(request: FastifyRequest) {
  if (request.currentMembership && request.tenantId) {
    return {
      user: request.currentUser!,
      membership: request.currentMembership,
      tenantId: request.tenantId
    };
  }

  const user = await authenticateUser(request);
  const requestedTenantId = tenantIdFromHeader(request) ?? tenantIdFromToken(request);

  const memberships = await prisma.tenantMembership.findMany({
    where: { userId: user.id },
    include: { tenant: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" }
  });

  if (memberships.length === 0) {
    throw conflict("TENANT_REQUIRED", "User does not belong to a workspace");
  }

  const membership = requestedTenantId
    ? memberships.find((entry) => entry.tenantId === requestedTenantId)
    : memberships.length === 1
      ? memberships[0]
      : memberships[0];

  if (!membership) {
    throw unauthorized("Workspace membership not found");
  }

  request.tenantId = membership.tenantId;
  request.currentMembership = {
    tenantId: membership.tenantId,
    tenantName: membership.tenant.name,
    role: membership.role
  };

  return {
    user,
    membership: request.currentMembership,
    tenantId: membership.tenantId
  };
}

export async function listUserWorkspaces(userId: string) {
  const memberships = await prisma.tenantMembership.findMany({
    where: { userId },
    include: { tenant: { select: { id: true, name: true, createdAt: true, updatedAt: true } } },
    orderBy: { updatedAt: "desc" }
  });

  return memberships.map((membership) => ({
    id: membership.tenant.id,
    name: membership.tenant.name,
    role: membership.role,
    createdAt: membership.tenant.createdAt,
    updatedAt: membership.tenant.updatedAt
  }));
}

export function activeTenantIdFromRequest(request: FastifyRequest) {
  return tenantIdFromHeader(request) ?? tenantIdFromToken(request);
}

function tenantIdFromHeader(request: FastifyRequest) {
  const value = request.headers["x-tenant-id"];
  return Array.isArray(value) ? value[0] : value;
}

function tenantIdFromToken(request: FastifyRequest) {
  const token = request.user as SessionPayload | undefined;
  return token?.activeTenantId;
}
