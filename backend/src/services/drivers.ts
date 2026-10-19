// Drivers: profile, sign-in account, pay terms, work history.
import { randomInt } from "node:crypto";
import { Prisma, type CompensationMethod, type DriverStatus } from "@prisma/client";
import type { Db } from "../db.js";
import { workingDays } from "../domain/pay.js";
import { dateOnly, dateOnlyString, istDateString, monthRange } from "../domain/time.js";
import { parsePaise, tenthsToString } from "../domain/units.js";
import { audit } from "../lib/audit.js";
import { hashSecret } from "../lib/auth.js";
import { moneyDec, toTenths } from "../lib/dec.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { type AdminActor, assertCan, assertCanAny } from "./actor.js";
import { OPEN_STATUSES } from "./assignments.js";

const PHONE = /^\+?[\d\s-]{10,16}$/;
const tempPin = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export interface DriverInput {
  fullName: string;
  phone: string;
  emergencyContact?: string | null;
  licenseNumber?: string | null;
  licenseExpiry?: string | null;
  joinedOn?: string | null;
  address?: string | null;
}

function clean(input: Partial<DriverInput>) {
  if (input.phone !== undefined && !PHONE.test(input.phone)) throw badRequest("INVALID_PHONE", "Enter a valid mobile number.");
  return {
    ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}),
    ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}),
    emergencyContact: input.emergencyContact,
    licenseNumber: input.licenseNumber,
    licenseExpiry: input.licenseExpiry ? dateOnly(input.licenseExpiry) : input.licenseExpiry === null ? null : undefined,
    joinedOn: input.joinedOn ? dateOnly(input.joinedOn) : input.joinedOn === null ? null : undefined,
    address: input.address,
  };
}

const compDto = (c: { method: CompensationMethod; hourlyRate: Prisma.Decimal | null; monthlySalary: Prisma.Decimal | null; effectiveFrom: Date; note: string | null }) => ({
  method: c.method,
  hourlyRate: c.hourlyRate?.toFixed(2) ?? null,
  monthlySalary: c.monthlySalary?.toFixed(2) ?? null,
  effectiveFrom: dateOnlyString(c.effectiveFrom),
  note: c.note,
});

export async function listDrivers(db: Db, actor: AdminActor, q: { search?: string; status?: DriverStatus }) {
  // Payroll staff may view drivers; changing them needs DRIVERS.
  assertCanAny(actor, "DRIVERS", "PAYROLL");
  const today = istDateString(new Date());
  const { start } = monthRange(today.slice(0, 7));
  const rows = await db.driver.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ fullName: { contains: q.search, mode: "insensitive" } }, { driverCode: { contains: q.search, mode: "insensitive" } }, { phone: { contains: q.search } }] } : {}),
    },
    include: {
      workOrders: { where: { status: { in: OPEN_STATUSES } }, include: { vehicle: true }, orderBy: { workDate: "asc" } },
      approved: { where: { workDate: { gte: dateOnly(start) } }, select: { approvedHours: true, workDate: true } },
      compensation: { where: { effectiveFrom: { lte: dateOnly(today) } }, orderBy: { effectiveFrom: "desc" }, take: 1 },
    },
    orderBy: { fullName: "asc" },
  });
  const showPay = actor.permissions.has("PAYROLL");
  return rows.map((d) => {
    const active = d.workOrders.find((w) => w.status === "IN_PROGRESS") ?? d.workOrders[0];
    return {
      id: d.id,
      driverCode: d.driverCode,
      fullName: d.fullName,
      phone: d.phone,
      status: d.status,
      onDuty: d.workOrders.some((w) => w.status === "IN_PROGRESS"),
      openJobs: d.workOrders.length,
      current: active ? { workOrderId: active.id, code: active.code, status: active.status, vehicle: `${active.vehicle.make} ${active.vehicle.model}`, siteName: active.siteName } : null,
      monthHours: tenthsToString(d.approved.reduce((s, a) => s + toTenths(a.approvedHours), 0)),
      monthWorkingDays: workingDays(d.approved.map((a) => dateOnlyString(a.workDate))),
      compensation: showPay && d.compensation[0] ? compDto(d.compensation[0]) : null,
      licenseExpiry: d.licenseExpiry ? dateOnlyString(d.licenseExpiry) : null,
    };
  });
}

export async function getDriver(db: Db, actor: AdminActor, id: string) {
  // Payroll staff may view drivers; changing them needs DRIVERS.
  assertCanAny(actor, "DRIVERS", "PAYROLL");
  const d = await db.driver.findUnique({
    where: { id },
    include: {
      user: { select: { loginId: true, status: true, lockedUntil: true } },
      compensation: { orderBy: { effectiveFrom: "desc" } },
      workOrders: { where: { status: { in: OPEN_STATUSES } }, include: { vehicle: true, customer: true }, orderBy: { workDate: "asc" } },
    },
  });
  if (!d) throw notFound("Driver");
  const since = dateOnly(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [recent, pending] = await Promise.all([
    db.approvedWork.findMany({ where: { driverId: id, workDate: { gte: since } }, select: { approvedHours: true, workDate: true, driverAmount: true } }),
    db.workOrder.count({ where: { driverId: id, status: { in: ["PENDING_APPROVAL", "CORRECTION_REQUIRED"] } } }),
  ]);
  const showPay = actor.permissions.has("PAYROLL");
  return {
    id: d.id,
    driverCode: d.driverCode,
    fullName: d.fullName,
    phone: d.phone,
    emergencyContact: d.emergencyContact,
    licenseNumber: d.licenseNumber,
    licenseExpiry: d.licenseExpiry ? dateOnlyString(d.licenseExpiry) : null,
    joinedOn: d.joinedOn ? dateOnlyString(d.joinedOn) : null,
    address: d.address,
    status: d.status,
    account: { loginId: d.user.loginId, status: d.user.status, locked: !!d.user.lockedUntil && d.user.lockedUntil > new Date() },
    compensation: showPay ? d.compensation.map(compDto) : null,
    openJobs: d.workOrders.map((w) => ({ id: w.id, code: w.code, status: w.status, workDate: dateOnlyString(w.workDate), vehicle: w.vehicle.unitCode, customerName: w.customer.name, siteName: w.siteName })),
    last30Days: {
      approvedHours: tenthsToString(recent.reduce((s, a) => s + toTenths(a.approvedHours), 0)),
      workingDays: workingDays(recent.map((a) => dateOnlyString(a.workDate))),
      pendingSubmissions: pending,
    },
  };
}

async function nextDriverCode(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('driver-code'))`;
  const rows = await tx.driver.findMany({ select: { driverCode: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.driverCode.replace(/\D/g, "")) || 0), 100);
  return `DRV-${max + 1}`;
}

/** Creates the driver and their sign-in account. The temporary PIN is returned once and never stored in plain text. */
export async function createDriver(
  db: Db,
  actor: AdminActor,
  input: DriverInput & { compensation?: { method: CompensationMethod; hourlyRate?: string; monthlySalary?: string; effectiveFrom: string } },
) {
  assertCan(actor, "DRIVERS");
  if (!input.fullName?.trim()) throw badRequest("NAME_REQUIRED", "Driver name is required.");
  if (input.compensation) assertCan(actor, "PAYROLL");
  const data = clean(input);
  const pin = tempPin();
  const pinHash = await hashSecret(pin);
  const driver = await db.$transaction(async (tx) => {
    const code = await nextDriverCode(tx);
    const user = await tx.user.create({ data: { loginId: code, passwordHash: pinHash, displayName: input.fullName.trim(), role: "DRIVER", phone: input.phone.trim() } });
    const d = await tx.driver.create({ data: { ...(data as Prisma.DriverUncheckedCreateInput), driverCode: code, userId: user.id } });
    if (input.compensation) await insertCompensation(tx, actor, d.id, input.compensation);
    await audit(tx, { actorId: actor.userId, action: "driver.created", entityType: "Driver", entityId: d.id, after: { driverCode: code, fullName: d.fullName } });
    return d;
  });
  return { driver, temporaryPin: pin };
}

export async function updateDriver(db: Db, actor: AdminActor, id: string, input: Partial<DriverInput>) {
  assertCan(actor, "DRIVERS");
  const data = clean(input);
  return db.$transaction(async (tx) => {
    const before = await tx.driver.findUnique({ where: { id } });
    if (!before) throw notFound("Driver");
    const d = await tx.driver.update({ where: { id }, data });
    if (data.fullName || data.phone) await tx.user.update({ where: { id: d.userId }, data: { displayName: d.fullName, phone: d.phone } });
    await audit(tx, { actorId: actor.userId, action: "driver.updated", entityType: "Driver", entityId: id, before: JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(d)) });
    return d;
  });
}

export async function setDriverStatus(db: Db, actor: AdminActor, id: string, status: DriverStatus, reason: string) {
  assertCan(actor, "DRIVERS");
  if (reason.trim().length < 3) throw badRequest("REASON_REQUIRED", "Give a short reason.");
  const d = await db.driver.findUnique({ where: { id }, include: { workOrders: { where: { status: { in: OPEN_STATUSES } } } } });
  if (!d) throw notFound("Driver");
  if (status !== "ACTIVE" && d.workOrders.length > 0) throw conflict("DRIVER_HAS_OPEN_JOBS", `Reassign ${d.workOrders.length} open job(s) first.`);
  await db.$transaction(async (tx) => {
    await tx.driver.update({ where: { id }, data: { status } });
    // An inactive driver loses app access immediately.
    if (status === "INACTIVE") await tx.session.updateMany({ where: { userId: d.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: "driver.status_changed", entityType: "Driver", entityId: id, before: { status: d.status }, after: { status }, reason: reason.trim() });
  });
}

export async function resetDriverPin(db: Db, actor: AdminActor, id: string) {
  assertCan(actor, "DRIVERS");
  const d = await db.driver.findUnique({ where: { id } });
  if (!d) throw notFound("Driver");
  const pin = tempPin();
  const hash = await hashSecret(pin);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: d.userId }, data: { passwordHash: hash, failedLoginCount: 0, lockedUntil: null } });
    await tx.session.updateMany({ where: { userId: d.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: "driver.pin_reset", entityType: "Driver", entityId: id });
  });
  return { temporaryPin: pin };
}

async function insertCompensation(
  tx: Prisma.TransactionClient,
  actor: AdminActor,
  driverId: string,
  input: { method: CompensationMethod; hourlyRate?: string; monthlySalary?: string; effectiveFrom: string; note?: string },
) {
  const hourly = input.method === "HOURLY" ? parsePaise(input.hourlyRate ?? "") : null;
  const salary = input.method === "FIXED" ? parsePaise(input.monthlySalary ?? "") : null;
  if (input.method === "HOURLY" && (hourly === null || hourly <= 0)) throw badRequest("INVALID_RATE", "Enter the driver's hourly rate.");
  if (input.method === "FIXED" && (salary === null || salary <= 0)) throw badRequest("INVALID_SALARY", "Enter the monthly salary.");
  const effectiveFrom = dateOnly(input.effectiveFrom);
  // Pay terms cannot be back-dated over work that is already in a payroll run.
  const paid = await tx.approvedWork.count({ where: { driverId, workDate: { gte: effectiveFrom }, payrollRunId: { not: null } } });
  if (paid > 0) throw conflict("PAYROLL_EXISTS", "Payroll already covers work on or after this date. Choose a later effective date.");
  try {
    const row = await tx.driverCompensation.create({
      data: {
        driverId,
        method: input.method,
        hourlyRate: hourly !== null ? moneyDec(hourly) : null,
        monthlySalary: salary !== null ? moneyDec(salary) : null,
        effectiveFrom,
        note: input.note?.trim() || null,
        createdById: actor.userId,
      },
    });
    await audit(tx, { actorId: actor.userId, action: "driver.compensation_added", entityType: "Driver", entityId: driverId, after: { ...input }, reason: input.note });
    return row;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict("COMPENSATION_EXISTS", "Pay terms already start on that date. Choose another date.");
    throw err;
  }
}

/** New pay terms from a date. Earlier work keeps the terms that applied when it was done (snapshotted at approval). */
export async function addCompensation(
  db: Db,
  actor: AdminActor,
  driverId: string,
  input: { method: CompensationMethod; hourlyRate?: string; monthlySalary?: string; effectiveFrom: string; note?: string },
) {
  assertCan(actor, "PAYROLL");
  if (!input.note || input.note.trim().length < 5) throw badRequest("REASON_REQUIRED", "Record why the pay terms are changing (at least 5 characters).");
  const d = await db.driver.findUnique({ where: { id: driverId } });
  if (!d) throw notFound("Driver");
  return db.$transaction((tx) => insertCompensation(tx, actor, driverId, input));
}

export async function driverWorkHistory(db: Db, actor: AdminActor, driverId: string, q: { from?: string; to?: string }) {
  // Payroll staff may view drivers; changing them needs DRIVERS.
  assertCanAny(actor, "DRIVERS", "PAYROLL");
  const range = q.from || q.to ? { workDate: { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lte: dateOnly(q.to) } : {}) } } : {};
  const rows = await db.workOrder.findMany({
    where: { driverId, ...range },
    include: { vehicle: true, customer: true, approved: true },
    orderBy: { workDate: "desc" },
    take: 200,
  });
  const showPay = actor.permissions.has("PAYROLL");
  const approved = rows.filter((r) => r.approved);
  return {
    summary: {
      approvedHours: tenthsToString(approved.reduce((s, r) => s + toTenths(r.approved!.approvedHours), 0)),
      workingDays: workingDays(approved.map((r) => dateOnlyString(r.workDate))),
      jobs: rows.length,
    },
    items: rows.map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      workDate: dateOnlyString(r.workDate),
      vehicle: r.vehicle.unitCode,
      customerName: r.customer.name,
      siteName: r.siteName,
      approvedHours: r.approved?.approvedHours.toFixed(1) ?? null,
      driverAmount: showPay ? (r.approved?.driverAmount.toFixed(2) ?? null) : null,
      inPayroll: r.approved ? r.approved.payrollRunId !== null : false,
    })),
  };
}
