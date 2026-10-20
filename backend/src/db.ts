import { Prisma, PrismaClient } from "@prisma/client";

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

/**
 * Interactive transactions (work orders, approvals, invoices, payroll) run several queries in sequence.
 * Prisma's default 5 s limit is too tight when the database is a network hop away from the server,
 * so allow 20 s to finish and 10 s to obtain a connection. Locally they complete in well under a second.
 */
const transactionOptions = { maxWait: 10_000, timeout: 20_000 };

export function createDb(url?: string): PrismaClient {
  return new PrismaClient({ transactionOptions, ...(url ? { datasources: { db: { url } } } : {}) });
}

export const decimalToNumber = (d: Prisma.Decimal | null | undefined): number | null =>
  d === null || d === undefined ? null : Number(d.toString());
