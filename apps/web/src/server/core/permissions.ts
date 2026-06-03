import type { FastifyRequest } from "fastify";
import type { TenantRole } from "./context.js";
import { authenticateUser, resolveTenantContext } from "./context.js";
import { forbidden } from "./errors.js";

const roleRank: Record<TenantRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3
};

export async function requireUser(request: FastifyRequest) {
  await authenticateUser(request);
}

export function requireTenantRole(minRole: TenantRole) {
  return async (request: FastifyRequest) => {
    const { membership } = await resolveTenantContext(request);
    if (roleRank[membership.role] < roleRank[minRole]) {
      throw forbidden();
    }
  };
}

export function isAdminRole(role: TenantRole) {
  return role === "OWNER" || role === "ADMIN";
}

export function isOwnerRole(role: TenantRole) {
  return role === "OWNER";
}

export function canManageOwnOrAdmin(request: FastifyRequest, ownerUserId: string) {
  const role = request.currentMembership?.role;
  if (role && isAdminRole(role)) return true;
  return request.currentUser?.id === ownerUserId;
}
