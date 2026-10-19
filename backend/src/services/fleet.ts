// Machines (vehicles) and attachments: records, default rates, live status, meter history.
import { Prisma, type VehicleStatus } from "@prisma/client";
import type { Db } from "../db.js";
import { dateOnly, dateOnlyString, istDateString } from "../domain/time.js";
import { audit } from "../lib/audit.js";
import { hrs, money, moneyDec } from "../lib/dec.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { parsePaise } from "../domain/units.js";
import { type AdminActor, assertCan } from "./actor.js";
import { OPEN_STATUSES } from "./assignments.js";

export type LiveStatus = "AVAILABLE" | "ASSIGNED" | "WORKING" | "MAINTENANCE" | "INACTIVE";

/** Admin-set states win; otherwise WORKING if a job is in progress, ASSIGNED if one is open today or later. */
export function liveStatus(stored: VehicleStatus, openStatuses: string[]): LiveStatus {
  if (stored !== "AVAILABLE") return stored;
  if (openStatuses.includes("IN_PROGRESS")) return "WORKING";
  if (openStatuses.length > 0) return "ASSIGNED";
  return "AVAILABLE";
}

const vehicleInput = {
  unitCode: (v: string) => v.trim().toUpperCase(),
  registrationNo: (v: string) => v.trim().toUpperCase().replace(/\s+/g, "-"),
};

export interface VehicleInput {
  unitCode: string;
  registrationNo: string;
  make: string;
  model: string;
  category: string;
  year?: number | null;
  chassisNo?: string | null;
  engineNo?: string | null;
  insuranceExpiry?: string | null;
  fitnessExpiry?: string | null;
  notes?: string | null;
}

const optDate = (d?: string | null) => (d ? dateOnly(d) : d === null ? null : undefined);

function mapUnique(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw conflict("DUPLICATE", `Another record already uses this ${String((err.meta?.target as string[] | undefined)?.join(", ") ?? "value")}.`);
  }
  throw err;
}

export async function listVehicles(db: Db, actor: AdminActor, q: { search?: string; status?: LiveStatus; category?: string }) {
  assertCan(actor, "FLEET");
  const today = dateOnly(istDateString(new Date()));
  const rows = await db.vehicle.findMany({
    where: {
      ...(q.category ? { category: q.category } : {}),
      ...(q.search
        ? { OR: ["unitCode", "registrationNo", "make", "model"].map((f) => ({ [f]: { contains: q.search!, mode: "insensitive" as const } })) }
        : {}),
    },
    include: {
      workOrders: { where: { status: { in: OPEN_STATUSES }, workDate: { gte: today } }, include: { driver: true, customer: true }, orderBy: { workDate: "asc" } },
      rates: { orderBy: { effectiveFrom: "desc" }, take: 1 },
      maintenance: { where: { status: { in: ["SCHEDULED", "IN_PROGRESS"] } }, orderBy: { scheduledOn: "asc" }, take: 1 },
    },
    orderBy: { unitCode: "asc" },
  });
  const items = rows.map((v) => {
    const status = liveStatus(v.status, v.workOrders.map((w) => w.status));
    const current = v.workOrders.find((w) => w.status === "IN_PROGRESS") ?? v.workOrders[0];
    return {
      id: v.id,
      unitCode: v.unitCode,
      registrationNo: v.registrationNo,
      make: v.make,
      model: v.model,
      category: v.category,
      storedStatus: v.status,
      status,
      lastApprovedMeter: hrs(v.lastApprovedMeter),
      defaultRate: money(v.rates[0]?.hourlyRate),
      current: current ? { workOrderId: current.id, code: current.code, siteName: current.siteName, driverName: current.driver.fullName, customerName: current.customer.name, workDate: dateOnlyString(current.workDate) } : null,
      nextMaintenance: v.maintenance[0] ? { title: v.maintenance[0].title, scheduledOn: v.maintenance[0].scheduledOn ? dateOnlyString(v.maintenance[0].scheduledOn) : null, status: v.maintenance[0].status } : null,
      insuranceExpiry: v.insuranceExpiry ? dateOnlyString(v.insuranceExpiry) : null,
      fitnessExpiry: v.fitnessExpiry ? dateOnlyString(v.fitnessExpiry) : null,
    };
  });
  const filtered = q.status ? items.filter((i) => i.status === q.status) : items;
  const counts = items.reduce<Record<string, number>>((acc, i) => ((acc[i.status] = (acc[i.status] ?? 0) + 1), acc), {});
  return { items: filtered, total: items.length, statusCounts: counts };
}

export async function getVehicle(db: Db, actor: AdminActor, id: string) {
  assertCan(actor, "FLEET");
  const today = dateOnly(istDateString(new Date()));
  const v = await db.vehicle.findUnique({
    where: { id },
    include: {
      rates: { orderBy: { effectiveFrom: "desc" } },
      workOrders: { where: { status: { in: OPEN_STATUSES }, workDate: { gte: today } }, include: { driver: true, customer: true }, orderBy: { workDate: "asc" } },
      maintenance: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!v) throw notFound("Vehicle");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [hours30, lifetime, expenses] = await Promise.all([
    db.approvedWork.aggregate({ where: { vehicleId: id, workDate: { gte: since } }, _sum: { approvedHours: true }, _count: true }),
    db.approvedWork.aggregate({ where: { vehicleId: id }, _sum: { approvedHours: true }, _count: true }),
    db.expense.aggregate({ where: { vehicleId: id }, _sum: { amount: true } }),
  ]);
  return {
    id: v.id,
    unitCode: v.unitCode,
    registrationNo: v.registrationNo,
    make: v.make,
    model: v.model,
    category: v.category,
    year: v.year,
    chassisNo: v.chassisNo,
    engineNo: v.engineNo,
    insuranceExpiry: v.insuranceExpiry ? dateOnlyString(v.insuranceExpiry) : null,
    fitnessExpiry: v.fitnessExpiry ? dateOnlyString(v.fitnessExpiry) : null,
    notes: v.notes,
    storedStatus: v.status,
    status: liveStatus(v.status, v.workOrders.map((w) => w.status)),
    lastApprovedMeter: hrs(v.lastApprovedMeter),
    rates: v.rates.map((r) => ({ id: r.id, hourlyRate: r.hourlyRate.toFixed(2), effectiveFrom: dateOnlyString(r.effectiveFrom) })),
    upcoming: v.workOrders.map((w) => ({ id: w.id, code: w.code, status: w.status, workDate: dateOnlyString(w.workDate), siteName: w.siteName, driverName: w.driver.fullName, customerName: w.customer.name })),
    maintenance: v.maintenance.map((m) => ({ id: m.id, title: m.title, category: m.category, status: m.status, scheduledOn: m.scheduledOn ? dateOnlyString(m.scheduledOn) : null, completedAt: m.completedAt?.toISOString() ?? null, cost: money(m.cost) })),
    stats: {
      approvedHours30d: hrs(hours30._sum.approvedHours) ?? "0.0",
      jobs30d: hours30._count,
      approvedHoursLifetime: hrs(lifetime._sum.approvedHours) ?? "0.0",
      jobsLifetime: lifetime._count,
      expensesTotal: money(expenses._sum.amount) ?? "0.00",
    },
  };
}

function cleanVehicle(input: Partial<VehicleInput>) {
  const year = input.year ?? undefined;
  if (year !== undefined && year !== null && (year < 1980 || year > new Date().getFullYear() + 1)) throw badRequest("INVALID_YEAR", "Enter a valid manufacturing year.");
  return {
    ...(input.unitCode !== undefined ? { unitCode: vehicleInput.unitCode(input.unitCode) } : {}),
    ...(input.registrationNo !== undefined ? { registrationNo: vehicleInput.registrationNo(input.registrationNo) } : {}),
    ...(input.make !== undefined ? { make: input.make.trim() } : {}),
    ...(input.model !== undefined ? { model: input.model.trim() } : {}),
    ...(input.category !== undefined ? { category: input.category.trim() } : {}),
    year,
    chassisNo: input.chassisNo,
    engineNo: input.engineNo,
    insuranceExpiry: optDate(input.insuranceExpiry),
    fitnessExpiry: optDate(input.fitnessExpiry),
    notes: input.notes,
  };
}

export async function createVehicle(db: Db, actor: AdminActor, input: VehicleInput & { hourlyRate?: string; rateEffectiveFrom?: string }) {
  assertCan(actor, "FLEET");
  const rate = input.hourlyRate ? parsePaise(input.hourlyRate) : null;
  if (input.hourlyRate && (rate === null || rate <= 0)) throw badRequest("INVALID_RATE", "Enter a valid hourly rate.");
  if (rate !== null) assertCan(actor, "RATES");
  try {
    return await db.$transaction(async (tx) => {
      const v = await tx.vehicle.create({ data: cleanVehicle(input) as Prisma.VehicleCreateInput });
      if (rate !== null) {
        await tx.vehicleRate.create({ data: { vehicleId: v.id, hourlyRate: moneyDec(rate), effectiveFrom: dateOnly(input.rateEffectiveFrom ?? istDateString(new Date())), createdById: actor.userId } });
      }
      await audit(tx, { actorId: actor.userId, action: "vehicle.created", entityType: "Vehicle", entityId: v.id, after: { unitCode: v.unitCode, registrationNo: v.registrationNo } });
      return v;
    });
  } catch (err) {
    mapUnique(err);
  }
}

export async function updateVehicle(db: Db, actor: AdminActor, id: string, input: Partial<VehicleInput>) {
  assertCan(actor, "FLEET");
  const before = await db.vehicle.findUnique({ where: { id } });
  if (!before) throw notFound("Vehicle");
  try {
    return await db.$transaction(async (tx) => {
      const v = await tx.vehicle.update({ where: { id }, data: cleanVehicle(input) });
      await audit(tx, { actorId: actor.userId, action: "vehicle.updated", entityType: "Vehicle", entityId: id, before: JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(v)) });
      return v;
    });
  } catch (err) {
    mapUnique(err);
  }
}

/** Set an admin-controlled status. A machine with open jobs cannot be moved to maintenance or inactive. */
export async function setVehicleStatus(db: Db, actor: AdminActor, id: string, status: VehicleStatus, reason: string) {
  assertCan(actor, "FLEET");
  if (reason.trim().length < 3) throw badRequest("REASON_REQUIRED", "Give a short reason.");
  const v = await db.vehicle.findUnique({ where: { id }, include: { workOrders: { where: { status: { in: OPEN_STATUSES } } } } });
  if (!v) throw notFound("Vehicle");
  if (status !== "AVAILABLE" && v.workOrders.length > 0) {
    throw conflict("VEHICLE_HAS_OPEN_JOBS", `Reassign or cancel ${v.workOrders.length} open job(s) first: ${v.workOrders.map((w) => w.code).join(", ")}.`);
  }
  await db.$transaction(async (tx) => {
    await tx.vehicle.update({ where: { id }, data: { status } });
    await audit(tx, { actorId: actor.userId, action: "vehicle.status_changed", entityType: "Vehicle", entityId: id, before: { status: v.status }, after: { status }, reason: reason.trim() });
  });
}

export async function addVehicleRate(db: Db, actor: AdminActor, vehicleId: string, input: { hourlyRate: string; effectiveFrom: string }) {
  assertCan(actor, "RATES");
  const rate = parsePaise(input.hourlyRate);
  if (rate === null || rate <= 0) throw badRequest("INVALID_RATE", "Enter a valid hourly rate.");
  try {
    return await db.$transaction(async (tx) => {
      const r = await tx.vehicleRate.create({ data: { vehicleId, hourlyRate: moneyDec(rate), effectiveFrom: dateOnly(input.effectiveFrom), createdById: actor.userId } });
      await audit(tx, { actorId: actor.userId, action: "rate.vehicle_default_added", entityType: "Vehicle", entityId: vehicleId, after: { hourlyRate: input.hourlyRate, effectiveFrom: input.effectiveFrom } });
      return r;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict("RATE_EXISTS", "A rate already starts on that date. Choose another effective date.");
    throw err;
  }
}

/** Approved meter history for a machine: one row per approved job, oldest-first gaps visible. */
export async function vehicleMeterHistory(db: Db, actor: AdminActor, vehicleId: string, q: { from?: string; to?: string }) {
  assertCan(actor, "FLEET");
  const rows = await db.approvedWork.findMany({
    where: { vehicleId, ...(q.from || q.to ? { workDate: { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lte: dateOnly(q.to) } : {}) } } : {}) },
    include: { workOrder: { include: { driver: true, customer: true, reviews: { orderBy: { createdAt: "desc" }, take: 1 } } } },
    orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rows.map((r) => ({
    workOrderId: r.workOrderId,
    code: r.workOrder.code,
    workDate: dateOnlyString(r.workDate),
    driverName: r.workOrder.driver.fullName,
    customerName: r.workOrder.customer.name,
    startMeter: r.startMeter.toFixed(1),
    endMeter: r.endMeter.toFixed(1),
    approvedHours: r.approvedHours.toFixed(1),
    breakerHours: r.breakerHours.toFixed(1),
    adjustmentKind: r.workOrder.reviews[0]?.adjustmentKind ?? null,
  }));
}

// ---- Attachments ----

export async function listAttachments(db: Db, actor: AdminActor) {
  assertCan(actor, "FLEET");
  const rows = await db.attachment.findMany({ include: { rates: { orderBy: { effectiveFrom: "desc" } }, workOrders: { include: { workOrder: true } } }, orderBy: { code: "asc" } });
  return rows.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    chargeable: a.chargeable,
    active: a.active,
    notes: a.notes,
    defaultRate: money(a.rates[0]?.hourlyCharge),
    rates: a.rates.map((r) => ({ hourlyCharge: r.hourlyCharge.toFixed(2), effectiveFrom: dateOnlyString(r.effectiveFrom) })),
    inUse: a.workOrders.some((w) => OPEN_STATUSES.includes(w.workOrder.status)),
  }));
}

export async function getAttachment(db: Db, actor: AdminActor, id: string) {
  assertCan(actor, "FLEET");
  const a = await db.attachment.findUnique({ where: { id }, include: { rates: { orderBy: { effectiveFrom: "desc" } } } });
  if (!a) throw notFound("Attachment");
  const usage = await db.approvedWork.findMany({
    where: { breakerAttachmentId: id },
    include: { workOrder: { include: { customer: true, vehicle: true } } },
    orderBy: { workDate: "desc" },
    take: 50,
  });
  const total = await db.approvedWork.aggregate({ where: { breakerAttachmentId: id }, _sum: { breakerHours: true } });
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    chargeable: a.chargeable,
    active: a.active,
    notes: a.notes,
    rates: a.rates.map((r) => ({ hourlyCharge: r.hourlyCharge.toFixed(2), effectiveFrom: dateOnlyString(r.effectiveFrom) })),
    totalBilledHours: hrs(total._sum.breakerHours) ?? "0.0",
    usage: usage.map((u) => ({ workOrderId: u.workOrderId, code: u.workOrder.code, workDate: dateOnlyString(u.workDate), customerName: u.workOrder.customer.name, vehicle: u.workOrder.vehicle.unitCode, hours: u.breakerHours.toFixed(1) })),
  };
}

export async function upsertAttachment(
  db: Db,
  actor: AdminActor,
  id: string | null,
  input: { code?: string; name?: string; type?: string; chargeable?: boolean; notes?: string | null; active?: boolean },
) {
  assertCan(actor, "FLEET");
  const data = {
    ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.type !== undefined ? { type: input.type.trim() } : {}),
    ...(input.chargeable !== undefined ? { chargeable: input.chargeable } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
    notes: input.notes,
  };
  try {
    return await db.$transaction(async (tx) => {
      const a = id ? await tx.attachment.update({ where: { id }, data }) : await tx.attachment.create({ data: data as Prisma.AttachmentCreateInput });
      await audit(tx, { actorId: actor.userId, action: id ? "attachment.updated" : "attachment.created", entityType: "Attachment", entityId: a.id, after: data });
      return a;
    });
  } catch (err) {
    mapUnique(err);
  }
}

export async function addAttachmentRate(db: Db, actor: AdminActor, attachmentId: string, input: { hourlyCharge: string; effectiveFrom: string }) {
  assertCan(actor, "RATES");
  const rate = parsePaise(input.hourlyCharge);
  if (rate === null || rate < 0) throw badRequest("INVALID_RATE", "Enter a valid hourly charge.");
  try {
    return await db.$transaction(async (tx) => {
      const r = await tx.attachmentRate.create({ data: { attachmentId, hourlyCharge: moneyDec(rate), effectiveFrom: dateOnly(input.effectiveFrom), createdById: actor.userId } });
      await audit(tx, { actorId: actor.userId, action: "rate.attachment_default_added", entityType: "Attachment", entityId: attachmentId, after: input });
      return r;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict("RATE_EXISTS", "A rate already starts on that date.");
    throw err;
  }
}
