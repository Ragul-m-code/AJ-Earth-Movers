// Customers, their sites, agreed rates and account ledger.
import { Prisma, type BillingCycle } from "@prisma/client";
import type { Db } from "../db.js";
import { displayStatus } from "../domain/billing.js";
import { dateOnly, dateOnlyString, istDateString } from "../domain/time.js";
import { paiseToString, parsePaise } from "../domain/units.js";
import { audit } from "../lib/audit.js";
import { moneyDec, toPaise } from "../lib/dec.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { type AdminActor, assertCan } from "./actor.js";

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export interface CustomerInput {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  billingCycle?: BillingCycle;
  paymentTermsDays?: number;
  notes?: string | null;
  active?: boolean;
}

function clean(input: Partial<CustomerInput>) {
  const gstin = input.gstin?.trim().toUpperCase() || (input.gstin === undefined ? undefined : null);
  // Format check only; whether a GSTIN is genuine must be confirmed by the accountant.
  if (gstin && !GSTIN.test(gstin)) throw badRequest("INVALID_GSTIN", "GSTIN must be 15 characters in the standard format (e.g. 27ABCDE1234F1Z5).");
  if (input.stateCode && !/^\d{2}$/.test(input.stateCode)) throw badRequest("INVALID_STATE_CODE", "State code must be 2 digits.");
  if (input.email && !/^\S+@\S+\.\S+$/.test(input.email)) throw badRequest("INVALID_EMAIL", "Enter a valid email address.");
  if (input.paymentTermsDays !== undefined && (input.paymentTermsDays < 0 || input.paymentTermsDays > 180)) throw badRequest("INVALID_TERMS", "Payment terms must be 0–180 days.");
  return {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    contactName: input.contactName,
    phone: input.phone,
    email: input.email,
    address: input.address,
    gstin,
    stateCode: input.stateCode ?? (gstin ? gstin.slice(0, 2) : undefined),
    billingCycle: input.billingCycle,
    paymentTermsDays: input.paymentTermsDays,
    notes: input.notes,
    active: input.active,
  };
}

export async function listCustomers(db: Db, actor: AdminActor, q: { search?: string; active?: boolean }) {
  assertCan(actor, "CUSTOMERS");
  const rows = await db.customer.findMany({
    where: {
      ...(q.active !== undefined ? { active: q.active } : {}),
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { phone: { contains: q.search } }, { gstin: { contains: q.search, mode: "insensitive" } }] } : {}),
    },
    include: {
      invoices: { where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { total: true, amountPaid: true, dueDate: true, status: true } },
      _count: { select: { sites: true, workOrders: true } },
    },
    orderBy: { name: "asc" },
  });
  const today = istDateString(new Date());
  const unbilled = await db.approvedWork.groupBy({ by: ["customerId"], where: { invoiceId: null }, _sum: { approvedHours: true }, _count: true });
  const unbilledBy = Object.fromEntries(unbilled.map((u) => [u.customerId, u]));
  return rows.map((c) => {
    const outstanding = c.invoices.reduce((s, i) => s + toPaise(i.total) - toPaise(i.amountPaid), 0);
    const overdue = c.invoices.filter((i) => displayStatus(i.status, i.dueDate ? dateOnlyString(i.dueDate) : null, today) === "OVERDUE");
    return {
      id: c.id,
      name: c.name,
      contactName: c.contactName,
      phone: c.phone,
      gstin: c.gstin,
      billingCycle: c.billingCycle,
      active: c.active,
      sites: c._count.sites,
      jobs: c._count.workOrders,
      outstanding: paiseToString(outstanding),
      overdueCount: overdue.length,
      overdueAmount: paiseToString(overdue.reduce((s, i) => s + toPaise(i.total) - toPaise(i.amountPaid), 0)),
      unbilledJobs: unbilledBy[c.id]?._count ?? 0,
      unbilledHours: unbilledBy[c.id]?._sum.approvedHours?.toFixed(1) ?? "0.0",
    };
  });
}

export async function getCustomer(db: Db, actor: AdminActor, id: string) {
  assertCan(actor, "CUSTOMERS");
  const c = await db.customer.findUnique({
    where: { id },
    include: {
      sites: { orderBy: { name: "asc" } },
      rates: { include: { vehicle: true }, orderBy: { effectiveFrom: "desc" } },
      attachmentRates: { include: { attachment: true }, orderBy: { effectiveFrom: "desc" } },
    },
  });
  if (!c) throw notFound("Customer");
  const canSeeMoney = actor.permissions.has("INVOICES") || actor.permissions.has("PAYMENTS");
  const [invoices, payments, unbilled, recentJobs] = await Promise.all([
    canSeeMoney ? db.invoice.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 20 }) : Promise.resolve([]),
    canSeeMoney ? db.payment.findMany({ where: { customerId: id }, include: { allocations: true }, orderBy: { receivedOn: "desc" }, take: 20 }) : Promise.resolve([]),
    db.approvedWork.aggregate({ where: { customerId: id, invoiceId: null }, _sum: { approvedHours: true }, _count: true }),
    db.workOrder.findMany({ where: { customerId: id }, include: { vehicle: true, driver: true }, orderBy: { workDate: "desc" }, take: 10 }),
  ]);
  const today = istDateString(new Date());
  const open = invoices.filter((i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID");
  return {
    id: c.id,
    name: c.name,
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
    address: c.address,
    gstin: c.gstin,
    stateCode: c.stateCode,
    billingCycle: c.billingCycle,
    paymentTermsDays: c.paymentTermsDays,
    notes: c.notes,
    active: c.active,
    sites: c.sites.map((s) => ({ id: s.id, name: s.name, address: s.address, contactName: s.contactName, contactPhone: s.contactPhone, active: s.active })),
    rates: c.rates.map((r) => ({
      id: r.id,
      scope: r.vehicleId ? "VEHICLE" : "CATEGORY",
      vehicle: r.vehicle ? { id: r.vehicle.id, unitCode: r.vehicle.unitCode, model: r.vehicle.model } : null,
      category: r.category,
      hourlyRate: r.hourlyRate.toFixed(2),
      effectiveFrom: dateOnlyString(r.effectiveFrom),
    })),
    attachmentRates: c.attachmentRates.map((r) => ({ id: r.id, attachment: { id: r.attachment.id, code: r.attachment.code, name: r.attachment.name }, hourlyCharge: r.hourlyCharge.toFixed(2), effectiveFrom: dateOnlyString(r.effectiveFrom) })),
    financials: canSeeMoney
      ? {
          outstanding: paiseToString(open.reduce((s, i) => s + toPaise(i.total) - toPaise(i.amountPaid), 0)),
          unallocatedCredit: paiseToString(payments.reduce((s, p) => s + toPaise(p.amount) - p.allocations.reduce((a, x) => a + toPaise(x.amount), 0), 0)),
          invoices: invoices.map((i) => ({
            id: i.id,
            number: i.number,
            kind: i.kind,
            status: displayStatus(i.status, i.dueDate ? dateOnlyString(i.dueDate) : null, today),
            periodStart: dateOnlyString(i.periodStart),
            periodEnd: dateOnlyString(i.periodEnd),
            total: i.total.toFixed(2),
            amountPaid: i.amountPaid.toFixed(2),
            dueDate: i.dueDate ? dateOnlyString(i.dueDate) : null,
          })),
          payments: payments.map((p) => ({ id: p.id, receivedOn: dateOnlyString(p.receivedOn), amount: p.amount.toFixed(2), mode: p.mode, reference: p.reference })),
        }
      : null,
    unbilled: { jobs: unbilled._count, hours: unbilled._sum.approvedHours?.toFixed(1) ?? "0.0" },
    recentJobs: recentJobs.map((w) => ({ id: w.id, code: w.code, status: w.status, workDate: dateOnlyString(w.workDate), siteName: w.siteName, vehicle: w.vehicle.unitCode, driverName: w.driver.fullName })),
  };
}

export async function saveCustomer(db: Db, actor: AdminActor, id: string | null, input: Partial<CustomerInput>) {
  assertCan(actor, "CUSTOMERS");
  if (!id && !input.name?.trim()) throw badRequest("NAME_REQUIRED", "Customer name is required.");
  const data = clean(input);
  return db.$transaction(async (tx) => {
    const before = id ? await tx.customer.findUnique({ where: { id } }) : null;
    if (id && !before) throw notFound("Customer");
    const c = id ? await tx.customer.update({ where: { id }, data }) : await tx.customer.create({ data: data as Prisma.CustomerCreateInput });
    await audit(tx, { actorId: actor.userId, action: id ? "customer.updated" : "customer.created", entityType: "Customer", entityId: c.id, before: before ? JSON.parse(JSON.stringify(before)) : undefined, after: JSON.parse(JSON.stringify(c)) });
    return c;
  });
}

export async function saveSite(db: Db, actor: AdminActor, customerId: string, siteId: string | null, input: { name?: string; address?: string | null; contactName?: string | null; contactPhone?: string | null; active?: boolean }) {
  assertCan(actor, "CUSTOMERS");
  if (!siteId && !input.name?.trim()) throw badRequest("NAME_REQUIRED", "Site name is required.");
  return db.$transaction(async (tx) => {
    if (siteId) {
      const s = await tx.site.findFirst({ where: { id: siteId, customerId } });
      if (!s) throw notFound("Site");
    }
    const data = { ...(input.name !== undefined ? { name: input.name.trim() } : {}), address: input.address, contactName: input.contactName, contactPhone: input.contactPhone, active: input.active };
    const site = siteId ? await tx.site.update({ where: { id: siteId }, data }) : await tx.site.create({ data: { ...data, name: input.name!.trim(), customerId } });
    await audit(tx, { actorId: actor.userId, action: siteId ? "site.updated" : "site.created", entityType: "Site", entityId: site.id, after: data });
    return site;
  });
}

/** Add a customer-agreed machine rate for one vehicle or a whole category, effective from a date. */
export async function addCustomerRate(db: Db, actor: AdminActor, customerId: string, input: { vehicleId?: string; category?: string; hourlyRate: string; effectiveFrom: string }) {
  assertCan(actor, "RATES");
  if (!!input.vehicleId === !!input.category?.trim()) throw badRequest("RATE_SCOPE", "Choose either one machine or a machine category.");
  const rate = parsePaise(input.hourlyRate);
  if (rate === null || rate <= 0) throw badRequest("INVALID_RATE", "Enter a valid hourly rate.");
  const effectiveFrom = dateOnly(input.effectiveFrom);
  const exists = await db.customerRate.findFirst({
    where: { customerId, effectiveFrom, ...(input.vehicleId ? { vehicleId: input.vehicleId } : { category: input.category!.trim(), vehicleId: null }) },
  });
  if (exists) throw conflict("RATE_EXISTS", "A rate for this scope already starts on that date.");
  return db.$transaction(async (tx) => {
    const r = await tx.customerRate.create({
      data: { customerId, vehicleId: input.vehicleId ?? null, category: input.vehicleId ? null : input.category!.trim(), hourlyRate: moneyDec(rate), effectiveFrom, createdById: actor.userId },
    });
    await audit(tx, { actorId: actor.userId, action: "rate.customer_machine_added", entityType: "Customer", entityId: customerId, after: input });
    return r;
  });
}

export async function addCustomerAttachmentRate(db: Db, actor: AdminActor, customerId: string, input: { attachmentId: string; hourlyCharge: string; effectiveFrom: string }) {
  assertCan(actor, "RATES");
  const rate = parsePaise(input.hourlyCharge);
  if (rate === null || rate < 0) throw badRequest("INVALID_RATE", "Enter a valid hourly charge.");
  try {
    return await db.$transaction(async (tx) => {
      const r = await tx.customerAttachmentRate.create({
        data: { customerId, attachmentId: input.attachmentId, hourlyCharge: moneyDec(rate), effectiveFrom: dateOnly(input.effectiveFrom), createdById: actor.userId },
      });
      await audit(tx, { actorId: actor.userId, action: "rate.customer_attachment_added", entityType: "Customer", entityId: customerId, after: input });
      return r;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict("RATE_EXISTS", "A rate for this attachment already starts on that date.");
    throw err;
  }
}

