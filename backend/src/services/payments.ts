// Customer payments and their allocation to issued invoices.
import { Prisma } from "@prisma/client";
import type { Db, Tx } from "../db.js";
import { statusAfterPayment } from "../domain/billing.js";
import { dateOnly, dateOnlyString } from "../domain/time.js";
import { paiseToString, parsePaise } from "../domain/units.js";
import { audit } from "../lib/audit.js";
import { moneyDec, toPaise } from "../lib/dec.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { type AdminActor, assertCan } from "./actor.js";

export const PAYMENT_MODES = ["NEFT", "RTGS", "IMPS", "UPI", "CHEQUE", "CASH", "OTHER"] as const;

export interface RecordPaymentInput {
  customerId: string;
  receivedOn: string;
  amount: string;
  mode: (typeof PAYMENT_MODES)[number];
  reference?: string;
  notes?: string;
  idempotencyKey: string;
  allocations: { invoiceId: string; amount: string }[];
}

async function applyAllocations(tx: Tx, paymentId: string, customerId: string, allocations: { invoiceId: string; amount: number }[]) {
  for (const a of allocations) {
    // Row lock: two payments against the same invoice are applied one after the other.
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Invoice" WHERE id = ${a.invoiceId} FOR UPDATE`;
    if (rows.length === 0) throw notFound("Invoice");
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
    if (inv.customerId !== customerId) throw badRequest("WRONG_CUSTOMER", `Invoice ${inv.number ?? "draft"} belongs to another customer.`);
    if (inv.status !== "ISSUED" && inv.status !== "PARTIALLY_PAID") throw conflict("NOT_PAYABLE", `Invoice ${inv.number ?? "draft"} is ${inv.status.toLowerCase().replace("_", " ")} and cannot take payments.`);
    const total = toPaise(inv.total);
    const paid = toPaise(inv.amountPaid) + a.amount;
    if (paid > total) {
      throw conflict("OVERPAYMENT", `₹${paiseToString(a.amount)} is more than the ₹${paiseToString(total - toPaise(inv.amountPaid))} due on ${inv.number}.`);
    }
    await tx.paymentAllocation.create({ data: { paymentId, invoiceId: a.invoiceId, amount: moneyDec(a.amount) } });
    await tx.invoice.update({ where: { id: a.invoiceId }, data: { amountPaid: moneyDec(paid), status: statusAfterPayment(total, paid) } });
  }
}

export async function recordPayment(db: Db, actor: AdminActor, input: RecordPaymentInput) {
  assertCan(actor, "PAYMENTS");
  const amount = parsePaise(input.amount);
  if (amount === null || amount <= 0) throw badRequest("INVALID_AMOUNT", "Enter the amount received.");
  const allocations = input.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: parsePaise(a.amount) }));
  if (allocations.some((a) => a.amount === null || a.amount <= 0)) throw badRequest("INVALID_AMOUNT", "Each allocation must be greater than zero.");
  if (new Set(allocations.map((a) => a.invoiceId)).size !== allocations.length) throw badRequest("DUPLICATE_ALLOCATION", "Allocate to each invoice once.");
  const allocated = allocations.reduce((s, a) => s + a.amount!, 0);
  if (allocated > amount) throw badRequest("OVER_ALLOCATED", "Allocations add up to more than the amount received.");

  const existing = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    // Same request repeated (e.g. a double tap or network retry): return the first result.
    if (existing.customerId !== input.customerId || toPaise(existing.amount) !== amount) throw conflict("IDEMPOTENCY_KEY_REUSED", "This request key was used for a different payment.");
    return { payment: await getPayment(db, actor, existing.id), replayed: true };
  }

  try {
    const id = await db.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw notFound("Customer");
      const p = await tx.payment.create({
        data: {
          customerId: input.customerId,
          receivedOn: dateOnly(input.receivedOn),
          amount: moneyDec(amount),
          mode: input.mode,
          reference: input.reference?.trim() || null,
          notes: input.notes?.trim() || null,
          idempotencyKey: input.idempotencyKey,
          recordedById: actor.userId,
        },
      });
      await applyAllocations(tx, p.id, input.customerId, allocations as { invoiceId: string; amount: number }[]);
      await audit(tx, { actorId: actor.userId, action: "payment.recorded", entityType: "Payment", entityId: p.id, after: { amount: input.amount, mode: input.mode, reference: input.reference, allocations: input.allocations } });
      return p.id;
    });
    return { payment: await getPayment(db, actor, id), replayed: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (again) return { payment: await getPayment(db, actor, again.id), replayed: true };
    }
    throw err;
  }
}

/** Apply a payment's unallocated balance (customer credit) to an invoice. */
export async function allocateCredit(db: Db, actor: AdminActor, paymentId: string, input: { invoiceId: string; amount: string }) {
  assertCan(actor, "PAYMENTS");
  const amount = parsePaise(input.amount);
  if (amount === null || amount <= 0) throw badRequest("INVALID_AMOUNT", "Enter an amount greater than zero.");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { allocations: true } });
    if (!p) throw notFound("Payment");
    const free = toPaise(p.amount) - p.allocations.reduce((s, a) => s + toPaise(a.amount), 0);
    if (amount > free) throw conflict("OVER_ALLOCATED", `Only ₹${paiseToString(free)} of this payment is unallocated.`);
    if (p.allocations.some((a) => a.invoiceId === input.invoiceId)) throw conflict("ALREADY_ALLOCATED", "This payment is already allocated to that invoice.");
    await applyAllocations(tx, paymentId, p.customerId, [{ invoiceId: input.invoiceId, amount }]);
    await audit(tx, { actorId: actor.userId, action: "payment.credit_allocated", entityType: "Payment", entityId: paymentId, after: input });
  });
  return getPayment(db, actor, paymentId);
}

export async function getPayment(db: Db, actor: AdminActor, id: string) {
  assertCan(actor, "PAYMENTS");
  const p = await db.payment.findUnique({ where: { id }, include: { customer: true, allocations: { include: { invoice: true } } } });
  if (!p) throw notFound("Payment");
  const allocated = p.allocations.reduce((s, a) => s + toPaise(a.amount), 0);
  return {
    id: p.id,
    customer: { id: p.customer.id, name: p.customer.name },
    receivedOn: dateOnlyString(p.receivedOn),
    amount: p.amount.toFixed(2),
    mode: p.mode,
    reference: p.reference,
    notes: p.notes,
    allocated: paiseToString(allocated),
    unallocated: paiseToString(toPaise(p.amount) - allocated),
    allocations: p.allocations.map((a) => ({ invoiceId: a.invoiceId, invoiceNumber: a.invoice.number, amount: a.amount.toFixed(2) })),
    createdAt: p.createdAt.toISOString(),
  };
}

export async function listPayments(db: Db, actor: AdminActor, q: { customerId?: string; from?: string; to?: string; page: number; pageSize: number }) {
  assertCan(actor, "PAYMENTS");
  const where: Prisma.PaymentWhereInput = {
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.from || q.to ? { receivedOn: { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lte: dateOnly(q.to) } : {}) } } : {}),
  };
  const [rows, total, sum] = await Promise.all([
    db.payment.findMany({ where, include: { customer: true, allocations: true }, orderBy: { receivedOn: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.payment.count({ where }),
    db.payment.aggregate({ where, _sum: { amount: true } }),
  ]);
  return {
    items: rows.map((p) => ({
      id: p.id,
      customer: { id: p.customer.id, name: p.customer.name },
      receivedOn: dateOnlyString(p.receivedOn),
      amount: p.amount.toFixed(2),
      mode: p.mode,
      reference: p.reference,
      unallocated: paiseToString(toPaise(p.amount) - p.allocations.reduce((s, a) => s + toPaise(a.amount), 0)),
    })),
    total,
    totalReceived: sum._sum.amount?.toFixed(2) ?? "0.00",
    page: q.page,
    pageSize: q.pageSize,
  };
}
