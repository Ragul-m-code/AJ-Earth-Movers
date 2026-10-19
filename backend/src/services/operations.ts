// Maintenance records and business expenses.
import { Prisma, type MaintenanceStatus } from "@prisma/client";
import type { Db } from "../db.js";
import { dateOnly, dateOnlyString } from "../domain/time.js";
import { parsePaise, parseTenths } from "../domain/units.js";
import { audit } from "../lib/audit.js";
import { hoursDec, money, moneyDec } from "../lib/dec.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { type AdminActor, assertCan } from "./actor.js";
import { OPEN_STATUSES } from "./assignments.js";

export interface MaintenanceInput {
  vehicleId: string;
  title: string;
  category: string;
  description?: string | null;
  scheduledOn?: string | null;
  meterReading?: string | null;
  vendor?: string | null;
  cost?: string | null;
}

const maintenanceDto = (m: Prisma.MaintenanceRecordGetPayload<{ include: { vehicle: true } }>) => ({
  id: m.id,
  vehicle: { id: m.vehicle.id, unitCode: m.vehicle.unitCode, make: m.vehicle.make, model: m.vehicle.model },
  title: m.title,
  category: m.category,
  description: m.description,
  status: m.status,
  scheduledOn: m.scheduledOn ? dateOnlyString(m.scheduledOn) : null,
  startedAt: m.startedAt?.toISOString() ?? null,
  completedAt: m.completedAt?.toISOString() ?? null,
  meterReading: m.meterReading?.toFixed(1) ?? null,
  vendor: m.vendor,
  cost: money(m.cost),
  downtimeHours: m.startedAt ? Math.round(((m.completedAt ?? new Date()).getTime() - m.startedAt.getTime()) / 360_000) / 10 : null,
});

export async function listMaintenance(db: Db, actor: AdminActor, q: { vehicleId?: string; status?: MaintenanceStatus }) {
  assertCan(actor, "MAINTENANCE");
  const rows = await db.maintenanceRecord.findMany({
    where: { ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}), ...(q.status ? { status: q.status } : {}) },
    include: { vehicle: true },
    orderBy: [{ status: "asc" }, { scheduledOn: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  const cost = await db.maintenanceRecord.aggregate({ where: { status: "COMPLETED", ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}) }, _sum: { cost: true } });
  return { items: rows.map(maintenanceDto), completedCost: money(cost._sum.cost) ?? "0.00" };
}

function cleanMaintenance(input: Partial<MaintenanceInput>) {
  const cost = input.cost ? parsePaise(input.cost) : null;
  if (input.cost && (cost === null || cost < 0)) throw badRequest("INVALID_COST", "Enter a valid cost.");
  const meter = input.meterReading ? parseTenths(input.meterReading) : null;
  if (input.meterReading && meter === null) throw badRequest("INVALID_METER", "Enter the meter reading with at most one decimal.");
  return {
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.category !== undefined ? { category: input.category.trim() } : {}),
    description: input.description,
    scheduledOn: input.scheduledOn ? dateOnly(input.scheduledOn) : input.scheduledOn === null ? null : undefined,
    meterReading: meter !== null ? hoursDec(meter) : input.meterReading === null ? null : undefined,
    vendor: input.vendor,
    cost: cost !== null ? moneyDec(cost) : input.cost === null ? null : undefined,
  };
}

export async function createMaintenance(db: Db, actor: AdminActor, input: MaintenanceInput) {
  assertCan(actor, "MAINTENANCE");
  if (!input.title?.trim()) throw badRequest("TITLE_REQUIRED", "Describe the maintenance.");
  const vehicle = await db.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw notFound("Vehicle");
  return db.$transaction(async (tx) => {
    const m = await tx.maintenanceRecord.create({ data: { ...(cleanMaintenance(input) as Prisma.MaintenanceRecordUncheckedCreateInput), vehicleId: input.vehicleId, createdById: actor.userId }, include: { vehicle: true } });
    await audit(tx, { actorId: actor.userId, action: "maintenance.created", entityType: "MaintenanceRecord", entityId: m.id, after: { vehicleId: input.vehicleId, title: input.title } });
    return maintenanceDto(m);
  });
}

export async function updateMaintenance(db: Db, actor: AdminActor, id: string, input: Partial<MaintenanceInput>) {
  assertCan(actor, "MAINTENANCE");
  return db.$transaction(async (tx) => {
    const before = await tx.maintenanceRecord.findUnique({ where: { id } });
    if (!before) throw notFound("Maintenance record");
    if (before.status === "COMPLETED" || before.status === "CANCELLED") throw conflict("CLOSED", "Completed or cancelled records cannot be edited.");
    const m = await tx.maintenanceRecord.update({ where: { id }, data: cleanMaintenance(input), include: { vehicle: true } });
    await audit(tx, { actorId: actor.userId, action: "maintenance.updated", entityType: "MaintenanceRecord", entityId: id, before: JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(input)) });
    return maintenanceDto(m);
  });
}

/** Start puts the machine into MAINTENANCE (blocked if it has open jobs); completing returns it to AVAILABLE. */
export async function setMaintenanceStatus(db: Db, actor: AdminActor, id: string, status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED", input: { cost?: string; note?: string } = {}) {
  assertCan(actor, "MAINTENANCE");
  return db.$transaction(async (tx) => {
    const m = await tx.maintenanceRecord.findUnique({ where: { id }, include: { vehicle: { include: { workOrders: { where: { status: { in: OPEN_STATUSES } } } } } } });
    if (!m) throw notFound("Maintenance record");
    const allowed: Record<string, string[]> = { SCHEDULED: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["COMPLETED"], COMPLETED: [], CANCELLED: [] };
    if (!allowed[m.status]!.includes(status)) throw conflict("INVALID_STATE", `A ${m.status.toLowerCase().replace("_", " ")} record cannot move to ${status.toLowerCase().replace("_", " ")}.`);
    if (status === "IN_PROGRESS" && m.vehicle.workOrders.length > 0) {
      throw conflict("VEHICLE_HAS_OPEN_JOBS", `Reassign or cancel the machine's open jobs first: ${m.vehicle.workOrders.map((w) => w.code).join(", ")}.`);
    }
    const cost = input.cost ? parsePaise(input.cost) : null;
    if (input.cost && (cost === null || cost < 0)) throw badRequest("INVALID_COST", "Enter a valid cost.");
    const updated = await tx.maintenanceRecord.update({
      where: { id },
      data: {
        status,
        ...(status === "IN_PROGRESS" ? { startedAt: new Date() } : {}),
        ...(status === "COMPLETED" ? { completedAt: new Date() } : {}),
        ...(cost !== null ? { cost: moneyDec(cost) } : {}),
      },
      include: { vehicle: true },
    });
    if (status === "IN_PROGRESS") await tx.vehicle.update({ where: { id: m.vehicleId }, data: { status: "MAINTENANCE" } });
    if (status === "COMPLETED" && m.vehicle.status === "MAINTENANCE") {
      const stillOpen = await tx.maintenanceRecord.count({ where: { vehicleId: m.vehicleId, status: "IN_PROGRESS", id: { not: id } } });
      if (stillOpen === 0) await tx.vehicle.update({ where: { id: m.vehicleId }, data: { status: "AVAILABLE" } });
    }
    await audit(tx, { actorId: actor.userId, action: `maintenance.${status.toLowerCase()}`, entityType: "MaintenanceRecord", entityId: id, after: input, reason: input.note });
    return maintenanceDto(updated);
  });
}

export const EXPENSE_CATEGORIES = ["Fuel (HSD)", "Repairs & spares", "Tyres", "Insurance", "Permits & taxes", "Transport", "Driver allowance", "Office", "Other"];

export async function listExpenses(db: Db, actor: AdminActor, q: { from?: string; to?: string; category?: string; vehicleId?: string }) {
  assertCan(actor, "EXPENSES");
  const where: Prisma.ExpenseWhereInput = {
    ...(q.category ? { category: q.category } : {}),
    ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
    ...(q.from || q.to ? { spentOn: { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lte: dateOnly(q.to) } : {}) } } : {}),
  };
  const [rows, byCategory, total] = await Promise.all([
    db.expense.findMany({ where, include: { vehicle: true }, orderBy: { spentOn: "desc" }, take: 300 }),
    db.expense.groupBy({ by: ["category"], where, _sum: { amount: true } }),
    db.expense.aggregate({ where, _sum: { amount: true } }),
  ]);
  return {
    items: rows.map((e) => ({ id: e.id, category: e.category, vehicle: e.vehicle ? { id: e.vehicle.id, unitCode: e.vehicle.unitCode } : null, spentOn: dateOnlyString(e.spentOn), amount: e.amount.toFixed(2), description: e.description, vendor: e.vendor, reference: e.reference })),
    byCategory: byCategory.map((c) => ({ category: c.category, amount: money(c._sum.amount) ?? "0.00" })).sort((a, b) => Number(b.amount) - Number(a.amount)),
    total: money(total._sum.amount) ?? "0.00",
    categories: EXPENSE_CATEGORIES,
  };
}

export async function createExpense(db: Db, actor: AdminActor, input: { category: string; vehicleId?: string | null; spentOn: string; amount: string; description: string; vendor?: string; reference?: string }) {
  assertCan(actor, "EXPENSES");
  const amount = parsePaise(input.amount);
  if (amount === null || amount <= 0) throw badRequest("INVALID_AMOUNT", "Enter an amount greater than zero.");
  if (input.description.trim().length < 3) throw badRequest("DESCRIPTION_REQUIRED", "Describe the expense.");
  return db.$transaction(async (tx) => {
    const e = await tx.expense.create({
      data: { category: input.category, vehicleId: input.vehicleId || null, spentOn: dateOnly(input.spentOn), amount: moneyDec(amount), description: input.description.trim(), vendor: input.vendor, reference: input.reference, createdById: actor.userId },
    });
    await audit(tx, { actorId: actor.userId, action: "expense.recorded", entityType: "Expense", entityId: e.id, after: input });
    return e;
  });
}
