// Customer invoices: draft from approved work, edit draft, verified-tax gate, issue, cancel.
import { Prisma, type InvoiceKind, type InvoiceStatus, type TaxSplit } from "@prisma/client";
import type { Db, Tx } from "../db.js";
import {
  displayStatus,
  invoiceNumber,
  invoiceTotals,
  percentToBasisPoints,
  resolveAttachmentRate,
  resolveMachineRate,
  workCharges,
  financialYear,
  type TaxInput,
} from "../domain/billing.js";
import type { EffectiveRate } from "../domain/pay.js";
import { dateOnly, dateOnlyString, istDateString } from "../domain/time.js";
import { paiseToString, parsePaise, tenthsToString } from "../domain/units.js";
import { audit } from "../lib/audit.js";
import { moneyDec, toPaise, toTenths } from "../lib/dec.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { type AdminActor, assertCan } from "./actor.js";

const rates = (rows: { effectiveFrom: Date; hourlyRate?: Prisma.Decimal; hourlyCharge?: Prisma.Decimal }[]): EffectiveRate[] =>
  rows.map((r) => ({ effectiveFrom: dateOnlyString(r.effectiveFrom), rate: toPaise(r.hourlyRate ?? r.hourlyCharge) }));

/** Everything needed to price a customer's work: their agreed rates and the machines' and attachments' defaults. */
async function pricingContext(db: Db | Tx, customerId: string) {
  const [customerRates, vehicleRates, attachmentDefaults, customerAttachment] = await Promise.all([
    db.customerRate.findMany({ where: { customerId } }),
    db.vehicleRate.findMany(),
    db.attachmentRate.findMany(),
    db.customerAttachmentRate.findMany({ where: { customerId } }),
  ]);
  return {
    machine(vehicleId: string, category: string, workDate: string) {
      return resolveMachineRate(
        {
          customerVehicle: rates(customerRates.filter((r) => r.vehicleId === vehicleId)),
          customerCategory: rates(customerRates.filter((r) => !r.vehicleId && r.category?.toLowerCase() === category.toLowerCase())),
          vehicleDefault: rates(vehicleRates.filter((r) => r.vehicleId === vehicleId)),
        },
        workDate,
      );
    },
    attachment(attachmentId: string, workDate: string) {
      return resolveAttachmentRate(
        rates(customerAttachment.filter((r) => r.attachmentId === attachmentId)),
        rates(attachmentDefaults.filter((r) => r.attachmentId === attachmentId)),
        workDate,
      );
    },
  };
}

const workInclude = { workOrder: true, vehicle: true, breakerAttachment: true } satisfies Prisma.ApprovedWorkInclude;
type WorkRow = Prisma.ApprovedWorkGetPayload<{ include: typeof workInclude }>;

function priceWork(ctx: Awaited<ReturnType<typeof pricingContext>>, w: WorkRow) {
  const workDate = dateOnlyString(w.workDate);
  const machine = ctx.machine(w.vehicleId, w.vehicle.category, workDate);
  const breakerHours = toTenths(w.breakerHours);
  const breaker = breakerHours > 0 && w.breakerAttachmentId ? ctx.attachment(w.breakerAttachmentId, workDate) : null;
  const missing: string[] = [];
  if (!machine) missing.push(`machine rate for ${w.vehicle.unitCode}`);
  if (breakerHours > 0 && !breaker) missing.push(`breaker rate for ${w.breakerAttachment?.code ?? "attachment"}`);
  if (missing.length) return { workDate, missing, machine: null, breaker: null, charges: null };
  const charges = workCharges({ hours: toTenths(w.approvedHours), machineRate: machine!.rate, breakerHours, breakerRate: breaker?.rate ?? null });
  return { workDate, missing, machine, breaker, charges };
}

/** Approved work for a customer and period, with prices previewed at the applicable rates. */
export async function billableWork(db: Db, actor: AdminActor, q: { customerId: string; from: string; to: string }) {
  assertCan(actor, "INVOICES");
  const range = { gte: dateOnly(q.from), lte: dateOnly(q.to) };
  const [ready, billed, pending, ctx] = await Promise.all([
    db.approvedWork.findMany({ where: { customerId: q.customerId, workDate: range, invoiceId: null }, include: workInclude, orderBy: { workDate: "asc" } }),
    db.approvedWork.findMany({ where: { customerId: q.customerId, workDate: range, invoiceId: { not: null } }, include: { ...workInclude, invoice: true }, orderBy: { workDate: "asc" } }),
    // Pending and rejected submissions are listed so the user sees why they are not billable.
    db.workOrder.findMany({ where: { customerId: q.customerId, workDate: range, status: { in: ["PENDING_APPROVAL", "CORRECTION_REQUIRED", "IN_PROGRESS"] } }, include: { vehicle: true, driver: true } }),
    pricingContext(db, q.customerId),
  ]);
  const items = ready.map((w) => {
    const p = priceWork(ctx, w);
    return {
      approvedWorkId: w.id,
      workOrderId: w.workOrderId,
      code: w.workOrder.code,
      workDate: p.workDate,
      siteName: w.workOrder.siteName,
      vehicle: { unitCode: w.vehicle.unitCode, make: w.vehicle.make, model: w.vehicle.model, category: w.vehicle.category },
      approvedHours: w.approvedHours.toFixed(1),
      breakerHours: w.breakerHours.toFixed(1),
      breaker: w.breakerAttachment ? { code: w.breakerAttachment.code, name: w.breakerAttachment.name } : null,
      machineRate: p.machine ? paiseToString(p.machine.rate) : null,
      machineRateSource: p.machine?.source ?? null,
      breakerRate: p.breaker ? paiseToString(p.breaker.rate) : null,
      machineCharge: p.charges ? paiseToString(p.charges.machine) : null,
      breakerCharge: p.charges ? paiseToString(p.charges.breaker) : null,
      missingRates: p.missing,
    };
  });
  return {
    items,
    total: paiseToString(items.reduce((s, i) => s + (parsePaise(i.machineCharge ?? "0") ?? 0) + (parsePaise(i.breakerCharge ?? "0") ?? 0), 0)),
    alreadyBilled: billed.map((w) => ({ code: w.workOrder.code, workDate: dateOnlyString(w.workDate), invoiceNumber: w.invoice?.number ?? "Draft", invoiceId: w.invoiceId })),
    notYetApproved: pending.map((w) => ({ workOrderId: w.id, code: w.code, status: w.status, workDate: dateOnlyString(w.workDate), vehicle: w.vehicle.unitCode, driverName: w.driver.fullName })),
  };
}

/** Lock the invoice row so concurrent edits to one draft are applied one at a time. */
async function lockInvoice(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) throw notFound("Invoice");
  return tx.invoice.findUniqueOrThrow({ where: { id }, include: { taxRule: true } });
}

function taxInput(inv: { kind: InvoiceKind; taxSplit: TaxSplit; cgstRate: Prisma.Decimal | null; sgstRate: Prisma.Decimal | null; igstRate: Prisma.Decimal | null }): TaxInput {
  if (inv.kind === "PROFORMA" || inv.taxSplit === "NONE") return { split: "NONE" };
  if (inv.taxSplit === "INTRA_STATE") return { split: "INTRA_STATE", cgstBp: percentToBasisPoints(inv.cgstRate!.toFixed(2)), sgstBp: percentToBasisPoints(inv.sgstRate!.toFixed(2)) };
  return { split: "INTER_STATE", igstBp: percentToBasisPoints(inv.igstRate!.toFixed(2)) };
}

/** Recompute stored totals from the lines. Always called inside the transaction that changed the lines. */
async function recompute(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } });
  const charges = inv.lines.filter((l) => l.kind !== "DISCOUNT").map((l) => toPaise(l.amount));
  const discounts = inv.lines.filter((l) => l.kind === "DISCOUNT").map((l) => toPaise(l.amount));
  let t;
  try {
    t = invoiceTotals(charges, discounts, taxInput(inv));
  } catch (e) {
    throw badRequest("INVALID_TOTALS", (e as Error).message);
  }
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotal: moneyDec(t.subtotal),
      discountTotal: moneyDec(t.discountTotal),
      taxableValue: moneyDec(t.taxableValue),
      cgstAmount: moneyDec(t.cgst),
      sgstAmount: moneyDec(t.sgst),
      igstAmount: moneyDec(t.igst),
      taxTotal: moneyDec(t.taxTotal),
      total: moneyDec(t.total),
    },
  });
}

async function addWorkLines(tx: Tx, invoiceId: string, customerId: string, ids: string[], startOrder: number) {
  // Claim the work atomically: if any of it was billed meanwhile, nothing is claimed and the request fails.
  const claimed = await tx.approvedWork.updateMany({ where: { id: { in: ids }, customerId, invoiceId: null }, data: { invoiceId } });
  if (claimed.count !== ids.length) throw conflict("ALREADY_BILLED", "Some of the selected work is already on another invoice or does not belong to this customer. Refresh and select again.");
  const work = await tx.approvedWork.findMany({ where: { id: { in: ids } }, include: workInclude, orderBy: { workDate: "asc" } });
  const ctx = await pricingContext(tx, customerId);
  let order = startOrder;
  const missing: string[] = [];
  const lines: Prisma.InvoiceLineCreateManyInput[] = [];
  for (const w of work) {
    const p = priceWork(ctx, w);
    if (p.missing.length) {
      missing.push(`${w.workOrder.code}: no ${p.missing.join(", ")} for ${p.workDate}`);
      continue;
    }
    lines.push({
      invoiceId,
      kind: "MACHINE",
      approvedWorkId: w.id,
      description: `${w.vehicle.make} ${w.vehicle.model} (${w.vehicle.unitCode}) · ${w.workOrder.code} · ${p.workDate} · ${w.workOrder.siteName}`,
      quantity: w.approvedHours,
      unitRate: moneyDec(p.machine!.rate),
      amount: moneyDec(p.charges!.machine),
      rateSource: p.machine!.source,
      sortOrder: order++,
    });
    if (p.charges!.breaker > 0) {
      lines.push({
        invoiceId,
        kind: "BREAKER",
        approvedWorkId: w.id,
        description: `${w.breakerAttachment!.name} surcharge · ${w.workOrder.code} · ${p.workDate}`,
        quantity: w.breakerHours,
        unitRate: moneyDec(p.breaker!.rate),
        amount: moneyDec(p.charges!.breaker),
        rateSource: p.breaker!.source,
        sortOrder: order++,
      });
    }
  }
  if (missing.length) throw conflict("RATE_MISSING", `Set the missing rates before invoicing: ${missing.join("; ")}.`, { missing });
  await tx.invoiceLine.createMany({ data: lines });
}

export interface CreateDraftInput {
  customerId: string;
  kind: InvoiceKind;
  periodStart: string;
  periodEnd: string;
  approvedWorkIds: string[];
  idempotencyKey: string;
  notes?: string;
}

export async function createInvoiceDraft(db: Db, actor: AdminActor, input: CreateDraftInput) {
  assertCan(actor, "INVOICES");
  if (input.approvedWorkIds.length === 0) throw badRequest("NO_WORK", "Select at least one approved work record.");
  if (input.periodEnd < input.periodStart) throw badRequest("INVALID_PERIOD", "The period end is before its start.");
  const existing = await db.invoice.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return getInvoice(db, actor, existing.id);
  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw notFound("Customer");
  const outside = await db.approvedWork.count({
    where: { id: { in: input.approvedWorkIds }, OR: [{ workDate: { lt: dateOnly(input.periodStart) } }, { workDate: { gt: dateOnly(input.periodEnd) } }] },
  });
  if (outside > 0) throw badRequest("OUTSIDE_PERIOD", "Some selected work falls outside the billing period.");

  try {
    const id = await db.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          kind: input.kind,
          customerId: customer.id,
          periodStart: dateOnly(input.periodStart),
          periodEnd: dateOnly(input.periodEnd),
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
          createdById: actor.userId,
        },
      });
      await addWorkLines(tx, inv.id, customer.id, [...new Set(input.approvedWorkIds)], 0);
      await recompute(tx, inv.id);
      await audit(tx, { actorId: actor.userId, action: "invoice.draft_created", entityType: "Invoice", entityId: inv.id, after: { customerId: customer.id, work: input.approvedWorkIds.length, kind: input.kind } });
      return inv.id;
    });
    return getInvoice(db, actor, id);
  } catch (err) {
    // A retried request that raced the first one: return the invoice it created.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await db.invoice.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (again) return getInvoice(db, actor, again.id);
    }
    throw err;
  }
}

async function editDraft<T>(db: Db, actor: AdminActor, invoiceId: string, action: string, fn: (tx: Tx, inv: Awaited<ReturnType<typeof lockInvoice>>) => Promise<T>, after?: Prisma.InputJsonValue) {
  assertCan(actor, "INVOICES");
  await db.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== "DRAFT") throw conflict("NOT_DRAFT", "Issued invoices cannot be edited. Cancel it (if unpaid) and create a new one.");
    await fn(tx, inv);
    await recompute(tx, invoiceId);
    await audit(tx, { actorId: actor.userId, action, entityType: "Invoice", entityId: invoiceId, after });
  });
  return getInvoice(db, actor, invoiceId);
}

export const addWorkToDraft = (db: Db, actor: AdminActor, invoiceId: string, approvedWorkIds: string[]) =>
  editDraft(db, actor, invoiceId, "invoice.work_added", async (tx, inv) => {
    const max = await tx.invoiceLine.aggregate({ where: { invoiceId }, _max: { sortOrder: true } });
    await addWorkLines(tx, invoiceId, inv.customerId, approvedWorkIds, (max._max.sortOrder ?? 0) + 1);
  }, { approvedWorkIds });

export const removeWorkFromDraft = (db: Db, actor: AdminActor, invoiceId: string, approvedWorkId: string) =>
  editDraft(db, actor, invoiceId, "invoice.work_removed", async (tx) => {
    const released = await tx.approvedWork.updateMany({ where: { id: approvedWorkId, invoiceId }, data: { invoiceId: null } });
    if (released.count !== 1) throw notFound("Work on this invoice");
    await tx.invoiceLine.deleteMany({ where: { invoiceId, approvedWorkId } });
  }, { approvedWorkId });

export function addManualLine(db: Db, actor: AdminActor, invoiceId: string, input: { kind: "OTHER" | "DISCOUNT"; description: string; amount: string }) {
  const amount = parsePaise(input.amount);
  if (amount === null || amount <= 0) throw badRequest("INVALID_AMOUNT", "Enter an amount greater than zero.");
  if (input.description.trim().length < 3) throw badRequest("DESCRIPTION_REQUIRED", "Describe the charge or discount.");
  return editDraft(db, actor, invoiceId, input.kind === "DISCOUNT" ? "invoice.discount_added" : "invoice.charge_added", async (tx) => {
    const max = await tx.invoiceLine.aggregate({ where: { invoiceId }, _max: { sortOrder: true } });
    await tx.invoiceLine.create({ data: { invoiceId, kind: input.kind, description: input.description.trim(), amount: moneyDec(amount), rateSource: "manual", sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  }, input);
}

export const removeManualLine = (db: Db, actor: AdminActor, invoiceId: string, lineId: string) =>
  editDraft(db, actor, invoiceId, "invoice.line_removed", async (tx) => {
    const res = await tx.invoiceLine.deleteMany({ where: { id: lineId, invoiceId, kind: { in: ["OTHER", "DISCOUNT"] } } });
    if (res.count !== 1) throw badRequest("LINE_NOT_REMOVABLE", "Only added charges and discounts can be removed. Remove work records instead.");
  }, { lineId });

/** Choose the tax treatment for a draft tax invoice. The rule may still be unverified; issuing checks verification. */
export function setDraftTax(db: Db, actor: AdminActor, invoiceId: string, input: { taxRuleId: string | null; split: TaxSplit }) {
  return editDraft(db, actor, invoiceId, "invoice.tax_set", async (tx, inv) => {
    if (inv.kind === "PROFORMA" && (input.taxRuleId || input.split !== "NONE")) throw badRequest("PROFORMA_NO_TAX", "A proforma invoice does not carry tax.");
    if (input.split === "NONE" || !input.taxRuleId) {
      await tx.invoice.update({ where: { id: invoiceId }, data: { taxRuleId: null, taxSplit: "NONE", cgstRate: null, sgstRate: null, igstRate: null } });
      return;
    }
    const rule = await tx.taxRule.findUnique({ where: { id: input.taxRuleId } });
    if (!rule || !rule.active) throw notFound("Tax rule");
    if (input.split === "INTRA_STATE" && (!rule.cgstRate || !rule.sgstRate)) throw badRequest("RULE_MISMATCH", "This tax rule has no CGST/SGST rates.");
    if (input.split === "INTER_STATE" && !rule.igstRate) throw badRequest("RULE_MISMATCH", "This tax rule has no IGST rate.");
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        taxRuleId: rule.id,
        taxSplit: input.split,
        cgstRate: input.split === "INTRA_STATE" ? rule.cgstRate : null,
        sgstRate: input.split === "INTRA_STATE" ? rule.sgstRate : null,
        igstRate: input.split === "INTER_STATE" ? rule.igstRate : null,
      },
    });
  }, input);
}

/** Problems that block issuing. Empty list = can be issued. */
export async function issueBlockers(db: Db | Tx, invoiceId: string): Promise<string[]> {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true, taxRule: true, customer: true } });
  const blockers: string[] = [];
  if (inv.status !== "DRAFT") blockers.push("Only drafts can be issued.");
  if (inv.lines.length === 0) blockers.push("The invoice has no lines.");
  if (inv.kind === "TAX_INVOICE") {
    const profile = await db.businessProfile.findUnique({ where: { id: "default" } });
    if (!profile || profile.verificationStatus !== "VERIFIED" || !profile.gstin || !profile.legalName) {
      blockers.push("Business profile (legal name, GSTIN, address) has not been verified by an authorized user.");
    }
    if (!inv.taxRule) blockers.push("Choose a tax rule.");
    else if (inv.taxRule.verificationStatus !== "VERIFIED") blockers.push(`Tax rule "${inv.taxRule.name}" has not been verified.`);
    if (!inv.customer.gstin && inv.taxSplit !== "NONE") blockers.push("The customer has no GSTIN recorded. Confirm the treatment with your accountant.");
  }
  return blockers;
}

export async function issueInvoice(db: Db, actor: AdminActor, invoiceId: string, input: { issueDate?: string }) {
  assertCan(actor, "INVOICES");
  const issueDate = input.issueDate ?? istDateString(new Date());
  await db.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== "DRAFT") {
      if (inv.status === "ISSUED" || inv.status === "PARTIALLY_PAID" || inv.status === "PAID") return; // repeated request: already issued
      throw conflict("NOT_DRAFT", "This invoice cannot be issued.");
    }
    const blockers = await issueBlockers(tx, invoiceId);
    if (blockers.length) throw conflict("CANNOT_ISSUE", blockers.join(" "), { blockers });

    const profile = await tx.businessProfile.findUnique({ where: { id: "default" } });
    const prefix = profile?.invoicePrefix || "AJ";
    // Tax invoices and proformas are numbered in separate series, e.g. AJ/2026-27/0001 and AJ-PF/2026-27/0001.
    const seriesPrefix = inv.kind === "PROFORMA" ? `${prefix}-PF` : prefix;
    const series = `${seriesPrefix}/${financialYear(issueDate)}/`;
    // Numbers must be unique and gap-free per series, so they are allocated under a lock at issue time.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-${series}`}))`;
    const last = await tx.invoice.findFirst({ where: { number: { startsWith: series } }, orderBy: { number: "desc" } });
    const seq = last?.number ? Number(last.number.slice(series.length)) + 1 : 1;
    const number = invoiceNumber(seriesPrefix, issueDate, seq);
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: inv.customerId } });
    const due = new Date(dateOnly(issueDate).getTime() + customer.paymentTermsDays * 86_400_000);
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        number,
        status: "ISSUED",
        issueDate: dateOnly(issueDate),
        dueDate: due,
        issuedAt: new Date(),
        issuedById: actor.userId,
        sellerSnapshot: profile ? JSON.parse(JSON.stringify(profile)) : Prisma.JsonNull,
        buyerSnapshot: { name: customer.name, address: customer.address, gstin: customer.gstin, stateCode: customer.stateCode, phone: customer.phone, email: customer.email },
      },
    });
    await audit(tx, { actorId: actor.userId, action: "invoice.issued", entityType: "Invoice", entityId: invoiceId, after: { number, total: inv.total.toFixed(2), issueDate } });
  });
  return getInvoice(db, actor, invoiceId);
}

export async function cancelInvoice(db: Db, actor: AdminActor, invoiceId: string, reason: string) {
  assertCan(actor, "INVOICES");
  if (reason.trim().length < 5) throw badRequest("REASON_REQUIRED", "Give a reason of at least 5 characters.");
  await db.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status === "CANCELLED") return;
    if (inv.status !== "DRAFT" && inv.status !== "ISSUED") throw conflict("HAS_PAYMENTS", "An invoice with payments cannot be cancelled. Record a credit adjustment with your accountant instead.");
    if (toPaise(inv.amountPaid) > 0) throw conflict("HAS_PAYMENTS", "An invoice with payments cannot be cancelled.");
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "CANCELLED", cancelReason: reason.trim(), cancelledAt: new Date(), cancelledById: actor.userId } });
    // Release the work so it can be billed correctly on a new invoice. The cancelled invoice keeps its lines for audit.
    await tx.approvedWork.updateMany({ where: { invoiceId }, data: { invoiceId: null } });
    await audit(tx, { actorId: actor.userId, action: "invoice.cancelled", entityType: "Invoice", entityId: invoiceId, before: { status: inv.status, number: inv.number }, reason: reason.trim() });
  });
  return getInvoice(db, actor, invoiceId);
}

export async function listInvoices(
  db: Db,
  actor: AdminActor,
  q: { status?: (InvoiceStatus | "OVERDUE")[]; customerId?: string; search?: string; from?: string; to?: string; page: number; pageSize: number },
) {
  assertCan(actor, "INVOICES");
  const today = istDateString(new Date());
  const statuses = q.status?.filter((s): s is InvoiceStatus => s !== "OVERDUE") ?? [];
  const wantOverdue = q.status?.includes("OVERDUE");
  const where: Prisma.InvoiceWhereInput = {
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.search ? { OR: [{ number: { contains: q.search, mode: "insensitive" } }, { customer: { name: { contains: q.search, mode: "insensitive" } } }] } : {}),
    ...(q.from || q.to ? { periodEnd: { ...(q.from ? { gte: dateOnly(q.from) } : {}) }, periodStart: { ...(q.to ? { lte: dateOnly(q.to) } : {}) } } : {}),
  };
  if (statuses.length || wantOverdue) {
    where.AND = [
      {
        OR: [
          ...(statuses.length ? [{ status: { in: statuses } }] : []),
          ...(wantOverdue ? [{ status: { in: ["ISSUED", "PARTIALLY_PAID"] as InvoiceStatus[] }, dueDate: { lt: dateOnly(today) } }] : []),
        ],
      },
    ];
  }
  const [rows, total, open] = await Promise.all([
    db.invoice.findMany({ where, include: { customer: true }, orderBy: [{ createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.invoice.count({ where }),
    db.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { total: true, amountPaid: true, dueDate: true, status: true } }),
  ]);
  const outstanding = open.reduce((s, i) => s + toPaise(i.total) - toPaise(i.amountPaid), 0);
  const overdue = open.filter((i) => displayStatus(i.status, i.dueDate ? dateOnlyString(i.dueDate) : null, today) === "OVERDUE");
  return {
    items: rows.map((i) => ({
      id: i.id,
      number: i.number,
      kind: i.kind,
      status: displayStatus(i.status, i.dueDate ? dateOnlyString(i.dueDate) : null, today),
      customer: { id: i.customer.id, name: i.customer.name },
      periodStart: dateOnlyString(i.periodStart),
      periodEnd: dateOnlyString(i.periodEnd),
      issueDate: i.issueDate ? dateOnlyString(i.issueDate) : null,
      dueDate: i.dueDate ? dateOnlyString(i.dueDate) : null,
      total: i.total.toFixed(2),
      amountPaid: i.amountPaid.toFixed(2),
      balance: paiseToString(toPaise(i.total) - toPaise(i.amountPaid)),
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    summary: {
      outstanding: paiseToString(outstanding),
      overdueAmount: paiseToString(overdue.reduce((s, i) => s + toPaise(i.total) - toPaise(i.amountPaid), 0)),
      overdueCount: overdue.length,
    },
  };
}

export async function getInvoice(db: Db, actor: AdminActor, id: string) {
  assertCan(actor, "INVOICES");
  const inv = await db.invoice.findUnique({
    where: { id },
    include: { customer: true, taxRule: true, lines: { orderBy: { sortOrder: "asc" } }, allocations: { include: { payment: true } } },
  });
  if (!inv) throw notFound("Invoice");
  const today = istDateString(new Date());
  const profile = await db.businessProfile.findUnique({ where: { id: "default" } });
  const blockers = inv.status === "DRAFT" ? await issueBlockers(db, id) : [];
  return {
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    status: displayStatus(inv.status, inv.dueDate ? dateOnlyString(inv.dueDate) : null, today),
    storedStatus: inv.status,
    customer: { id: inv.customer.id, name: inv.customer.name, gstin: inv.customer.gstin, address: inv.customer.address, stateCode: inv.customer.stateCode },
    periodStart: dateOnlyString(inv.periodStart),
    periodEnd: dateOnlyString(inv.periodEnd),
    issueDate: inv.issueDate ? dateOnlyString(inv.issueDate) : null,
    dueDate: inv.dueDate ? dateOnlyString(inv.dueDate) : null,
    taxRule: inv.taxRule ? { id: inv.taxRule.id, name: inv.taxRule.name, sacCode: inv.taxRule.sacCode, verified: inv.taxRule.verificationStatus === "VERIFIED" } : null,
    taxSplit: inv.taxSplit,
    rates: { cgst: inv.cgstRate?.toFixed(2) ?? null, sgst: inv.sgstRate?.toFixed(2) ?? null, igst: inv.igstRate?.toFixed(2) ?? null },
    lines: inv.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      approvedWorkId: l.approvedWorkId,
      description: l.description,
      quantity: l.quantity?.toFixed(1) ?? null,
      unitRate: l.unitRate?.toFixed(2) ?? null,
      amount: l.amount.toFixed(2),
      rateSource: l.rateSource,
    })),
    totals: {
      subtotal: inv.subtotal.toFixed(2),
      discountTotal: inv.discountTotal.toFixed(2),
      taxableValue: inv.taxableValue.toFixed(2),
      cgst: inv.cgstAmount.toFixed(2),
      sgst: inv.sgstAmount.toFixed(2),
      igst: inv.igstAmount.toFixed(2),
      taxTotal: inv.taxTotal.toFixed(2),
      total: inv.total.toFixed(2),
      amountPaid: inv.amountPaid.toFixed(2),
      balance: paiseToString(toPaise(inv.total) - toPaise(inv.amountPaid)),
      hours: tenthsToString(inv.lines.filter((l) => l.kind === "MACHINE").reduce((s, l) => s + toTenths(l.quantity), 0)),
    },
    payments: inv.allocations.map((a) => ({ paymentId: a.paymentId, amount: a.amount.toFixed(2), receivedOn: dateOnlyString(a.payment.receivedOn), mode: a.payment.mode, reference: a.payment.reference })),
    issueBlockers: blockers,
    taxVerified: inv.kind === "PROFORMA" || (inv.taxRule?.verificationStatus === "VERIFIED" && profile?.verificationStatus === "VERIFIED"),
    seller: inv.sellerSnapshot ?? (profile ? { legalName: profile.legalName, gstin: profile.gstin, address: profile.address, verificationStatus: profile.verificationStatus } : null),
    notes: inv.notes,
    cancelReason: inv.cancelReason,
  };
}
