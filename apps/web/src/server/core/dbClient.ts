import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * Resolve the Prisma client for an optional transaction: the transaction client
 * when one is provided, otherwise the shared singleton.
 */
export function db(tx?: Prisma.TransactionClient): Prisma.TransactionClient | PrismaClient {
  return tx ?? prisma;
}
