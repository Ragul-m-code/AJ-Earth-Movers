import { Prisma, PrismaClient } from "@prisma/client";

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

export function createDb(url?: string): PrismaClient {
  return new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
}

export const decimalToNumber = (d: Prisma.Decimal | null | undefined): number | null =>
  d === null || d === undefined ? null : Number(d.toString());
