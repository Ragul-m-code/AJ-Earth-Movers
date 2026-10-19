// Work orders on the admin side: create, assign, reassign, cancel, list.
import { Prisma, type WorkOrderStatus } from "@prisma/client";
import type { Db, Tx } from "../db.js";
import { dateOnly, dateOnlyString } from "../domain/time.js";
import { canTransition } from "../domain/workOrderStatus.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { getMeterThresholds } from "../lib/settings.js";
import { type AdminActor, assertCan } from "./actor.js";
import { currentFlags, workOrderDetailDto, workOrderDetailInclude, workOrderSummaryDto, workOrderInclude } from "./serialize.js";
import { toTenths } from "../lib/dec.js";

export const OPEN_STATUSES: WorkOrderStatus[] = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"];

export interface CreateWorkOrderInput {
  customerId: string;
  vehicleId: string;
  driverId: string;
  workDate: string;
  siteId?: string;
  siteName?: string;
  siteAddress?: string;
  siteContactName?: string;
  siteContactPhone?: string;
  shiftLabel?: string;
  instructions?: string;
  plannedHours?: string;
  attachmentIds?: string[];
  isSample?: boolean;
}

async function nextCode(tx: Tx, year: string) {
  // Serialize code allocation per year so concurrent creations cannot collide.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-code-${year}`}))`;
  const last = await tx.workOrder.findFirst({ where: { code: { startsWith: `WO-${year}-` } }, orderBy: { code: "desc" } });
  const n = last ? Number(last.code.split("-")[2]) + 1 : 1;
  return `WO-${year}-${String(n).padStart(4, "0")}`;
}

async function assertMachineFree(tx: Tx, vehicleId: string, workDate: Date, exceptId?: string) {
  const clash = await tx.workOrder.findFirst({
    where: { vehicleId, workDate, status: { in: OPEN_STATUSES }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    include: { driver: true },
  });
  if (clash) {
    throw conflict("VEHICLE_BOOKED", `This machine already has an open job on ${dateOnlyString(workDate)} (${clash.code}, ${clash.driver.fullName}).`, {
      workOrderId: clash.id,
    });
  }
}

async function loadParts(db: Db | Tx, input: Pick<CreateWorkOrderInput, "customerId" | "vehicleId" | "driverId" | "siteId" | "attachmentIds">) {
  const [customer, vehicle, driver, site, attachments] = await Promise.all([
    db.customer.findUnique({ where: { id: input.customerId } }),
    db.vehicle.findUnique({ where: { id: input.vehicleId } }),
    db.driver.findUnique({ where: { id: input.driverId } }),
    input.siteId ? db.site.findUnique({ where: { id: input.siteId } }) : Promise.resolve(null),
    db.attachment.findMany({ where: { id: { in: input.attachmentIds ?? [] } } }),
  ]);
  if (!customer || !customer.active) throw notFound("Customer");
  if (!vehicle) throw notFound("Vehicle");
  if (!driver) throw notFound("Driver");
  if (input.siteId && (!site || site.customerId !== customer.id)) throw badRequest("SITE_MISMATCH", "The site does not belong to this customer.");
  if (attachments.length !== new Set(input.attachmentIds ?? []).size || attachments.some((a) => !a.active)) throw notFound("Attachment");
  if (driver.status !== "ACTIVE") throw conflict("DRIVER_UNAVAILABLE", `${driver.fullName} is not active.`);
  if (vehicle.status !== "AVAILABLE") throw conflict("VEHICLE_UNAVAILABLE", `${vehicle.unitCode} is ${vehicle.status.toLowerCase()} and cannot be assigned.`);
  return { customer, vehicle, driver, site, attachments };
}

export async function createWorkOrder(db: Db, actor: AdminActor, input: CreateWorkOrderInput) {
  assertCan(actor, "WORK_ORDERS");
  const workDate = dateOnly(input.workDate);
  const { customer, vehicle, driver, site, attachments } = await loadParts(db, input);
  const siteName = (input.siteName ?? site?.name ?? "").trim();
  if (!siteName) throw badRequest("SITE_REQUIRED", "Job location is required.");
  if (input.plannedHours !== undefined && !/^\d{1,2}(\.\d)?$/.test(input.plannedHours)) throw badRequest("INVALID_HOURS", "Planned hours must be a number like 8 or 8.5.");

  try {
    return await db.$transaction(async (tx) => {
      // Serialize bookings per machine; the partial unique index is the last line of defence.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vehicle-${vehicle.id}`}))`;
      await assertMachineFree(tx, vehicle.id, workDate);
      const code = await nextCode(tx, input.workDate.slice(0, 4));
      const wo = await tx.workOrder.create({
        data: {
          code,
          customerId: customer.id,
          vehicleId: vehicle.id,
          driverId: driver.id,
          workDate,
          siteId: site?.id,
          siteName,
          siteAddress: input.siteAddress ?? site?.address ?? null,
          siteContactName: input.siteContactName ?? site?.contactName ?? null,
          siteContactPhone: input.siteContactPhone ?? site?.contactPhone ?? null,
          shiftLabel: input.shiftLabel,
          instructions: input.instructions,
          plannedHours: input.plannedHours ? new Prisma.Decimal(input.plannedHours) : null,
          createdById: actor.userId,
          isSample: input.isSample ?? false,
          attachments: { create: attachments.map((a) => ({ attachmentId: a.id })) },
        },
      });
      await tx.workOrderEvent.create({ data: { workOrderId: wo.id, toStatus: "ASSIGNED", actorId: actor.userId } });
      await audit(tx, { actorId: actor.userId, action: "work_order.created", entityType: "WorkOrder", entityId: wo.id, after: { code, workDate: input.workDate, driverId: driver.id, vehicleId: vehicle.id } });
      await tx.notification.create({
        data: {
          userId: driver.userId,
          type: "ASSIGNMENT",
          title: `New job: ${code}`,
          body: `${vehicle.make} ${vehicle.model} (${vehicle.registrationNo}) at ${siteName} on ${input.workDate}. Accept or decline in My Work.`,
          workOrderId: wo.id,
        },
      });
      return wo;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict("VEHICLE_BOOKED", `This machine already has an open job on ${input.workDate}.`);
    }
    throw err;
  }
}

/** Change driver, machine, date or site while the job has not started. A declined job goes back to ASSIGNED. */
export async function reassignWorkOrder(
  db: Db,
  actor: AdminActor,
  id: string,
  input: Partial<Pick<CreateWorkOrderInput, "driverId" | "vehicleId" | "workDate" | "siteName" | "siteAddress" | "instructions" | "shiftLabel">> & { reason: string },
) {
  assertCan(actor, "WORK_ORDERS");
  if (input.reason.trim().length < 3) throw badRequest("REASON_REQUIRED", "Give a short reason for the change.");
  const wo = await db.workOrder.findUnique({ where: { id }, include: { driver: true } });
  if (!wo) throw notFound("Work order");
  if (wo.status !== "ASSIGNED" && wo.status !== "DECLINED") throw conflict("INVALID_STATE", "Only jobs not yet accepted (or declined) can be reassigned.");
  const parts = await loadParts(db, {
    customerId: wo.customerId,
    vehicleId: input.vehicleId ?? wo.vehicleId,
    driverId: input.driverId ?? wo.driverId,
  });
  const workDate = input.workDate ? dateOnly(input.workDate) : wo.workDate;

  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vehicle-${parts.vehicle.id}`}))`;
      await assertMachineFree(tx, parts.vehicle.id, workDate, wo.id);
      const res = await tx.workOrder.updateMany({
        where: { id, status: wo.status },
        data: {
          status: "ASSIGNED",
          driverId: parts.driver.id,
          vehicleId: parts.vehicle.id,
          workDate,
          siteName: input.siteName ?? undefined,
          siteAddress: input.siteAddress ?? undefined,
          instructions: input.instructions ?? undefined,
          shiftLabel: input.shiftLabel ?? undefined,
          declineReason: null,
          respondedAt: null,
          assignedAt: new Date(),
        },
      });
      if (res.count !== 1) throw conflict("STATUS_CHANGED", "This job was updated elsewhere. Refresh and try again.");
      await tx.workOrderEvent.create({ data: { workOrderId: id, fromStatus: wo.status, toStatus: "ASSIGNED", actorId: actor.userId, note: `Reassigned: ${input.reason.trim()}` } });
      await audit(tx, {
        actorId: actor.userId,
        action: "work_order.reassigned",
        entityType: "WorkOrder",
        entityId: id,
        before: { driverId: wo.driverId, vehicleId: wo.vehicleId, workDate: dateOnlyString(wo.workDate), status: wo.status },
        after: { driverId: parts.driver.id, vehicleId: parts.vehicle.id, workDate: dateOnlyString(workDate) },
        reason: input.reason.trim(),
      });
      if (parts.driver.id !== wo.driverId) {
        await tx.notification.create({ data: { userId: wo.driver.userId, type: "ASSIGNMENT_UPDATED", title: `Job removed: ${wo.code}`, body: "This job was reassigned by dispatch.", workOrderId: id } });
      }
      await tx.notification.create({
        data: { userId: parts.driver.userId, type: parts.driver.id !== wo.driverId ? "ASSIGNMENT" : "ASSIGNMENT_UPDATED", title: `${parts.driver.id !== wo.driverId ? "New job" : "Job updated"}: ${wo.code}`, body: `Scheduled for ${dateOnlyString(workDate)}. Check the details in My Work.`, workOrderId: id },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict("VEHICLE_BOOKED", "This machine already has an open job on that date.");
    throw err;
  }
}

export async function cancelWorkOrder(db: Db, actor: AdminActor, id: string, reason: string) {
  assertCan(actor, "WORK_ORDERS");
  if (reason.trim().length < 5) throw badRequest("REASON_REQUIRED", "Give a reason of at least 5 characters.");
  const wo = await db.workOrder.findUnique({ where: { id }, include: { driver: true } });
  if (!wo) throw notFound("Work order");
  // Jobs with meter readings cannot be cancelled: they must be reviewed, so the readings stay accountable.
  if (!canTransition(wo.status, "CANCELLED", "admin")) throw conflict("INVALID_STATE", "Only jobs that have not started can be cancelled.");
  await db.$transaction(async (tx) => {
    const res = await tx.workOrder.updateMany({ where: { id, status: wo.status }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.trim() } });
    if (res.count !== 1) throw conflict("STATUS_CHANGED", "This job was updated elsewhere. Refresh and try again.");
    await tx.workOrderEvent.create({ data: { workOrderId: id, fromStatus: wo.status, toStatus: "CANCELLED", actorId: actor.userId, note: reason.trim() } });
    await audit(tx, { actorId: actor.userId, action: "work_order.cancelled", entityType: "WorkOrder", entityId: id, reason: reason.trim() });
    await tx.notification.create({ data: { userId: wo.driver.userId, type: "ASSIGNMENT_UPDATED", title: `Job cancelled: ${wo.code}`, body: reason.trim(), workOrderId: id } });
  });
}

export interface AdminListQuery {
  status?: WorkOrderStatus[];
  driverId?: string;
  vehicleId?: string;
  customerId?: string;
  from?: string;
  to?: string;
  q?: string;
  sort?: "workDate" | "-workDate" | "submittedAt";
  page: number;
  pageSize: number;
}

export async function listWorkOrdersAdmin(db: Db, actor: AdminActor, query: AdminListQuery) {
  if (!actor.permissions.has("WORK_ORDERS") && !actor.permissions.has("METER_APPROVAL")) assertCan(actor, "WORK_ORDERS");
  const where: Prisma.WorkOrderWhereInput = {
    ...(query.status?.length ? { status: { in: query.status } } : {}),
    ...(query.driverId ? { driverId: query.driverId } : {}),
    ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
  };
  if (query.from || query.to) where.workDate = { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) };
  if (query.q) {
    const q = query.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { siteName: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { driver: { fullName: { contains: q, mode: "insensitive" } } },
      { vehicle: { registrationNo: { contains: q, mode: "insensitive" } } },
      { vehicle: { unitCode: { contains: q, mode: "insensitive" } } },
    ];
  }
  const orderBy: Prisma.WorkOrderOrderByWithRelationInput[] =
    query.sort === "submittedAt" ? [{ submittedAt: "asc" }] : query.sort === "workDate" ? [{ workDate: "asc" }] : [{ workDate: "desc" }, { code: "desc" }];
  const [rows, total, counts] = await Promise.all([
    db.workOrder.findMany({ where, include: { ...workOrderInclude, driver: true }, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    db.workOrder.count({ where }),
    db.workOrder.groupBy({ by: ["status"], _count: true }),
  ]);
  const thresholds = await getMeterThresholds(db);
  return {
    items: rows.map((wo) => ({
      ...workOrderSummaryDto(wo),
      driver: { id: wo.driver.id, driverCode: wo.driver.driverCode, fullName: wo.driver.fullName },
      vehicleId: wo.vehicleId,
      customerId: wo.customerId,
      flags: wo.status === "PENDING_APPROVAL" ? currentFlags(wo, thresholds, wo.vehicle.lastApprovedMeter ? toTenths(wo.vehicle.lastApprovedMeter) : null) : [],
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  };
}

export async function getWorkOrderAdmin(db: Db, actor: AdminActor, id: string) {
  if (!actor.permissions.has("WORK_ORDERS") && !actor.permissions.has("METER_APPROVAL")) assertCan(actor, "WORK_ORDERS");
  const wo = await db.workOrder.findUnique({
    where: { id },
    include: { ...workOrderDetailInclude, driver: true, createdBy: true, approved: { include: { invoice: true, payrollRun: true } } },
  });
  if (!wo) throw notFound("Work order");
  const baseline = await db.approvedWork.aggregate({
    where: { vehicleId: wo.vehicleId, workDate: { lte: wo.workDate }, workOrderId: { not: wo.id } },
    _max: { endMeter: true },
  });
  const flags = wo.status === "APPROVED" ? (wo.reviews.at(-1)?.flagsAtReview ?? []) : currentFlags(wo, await getMeterThresholds(db), baseline._max.endMeter ? toTenths(baseline._max.endMeter) : null);
  const reviewerIds = [...new Set(wo.reviews.map((r) => r.reviewerId))];
  const reviewers = await db.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, displayName: true } });
  const nameOf = Object.fromEntries(reviewers.map((u) => [u.id, u.displayName]));
  const history = await db.approvedWork.findMany({
    where: { vehicleId: wo.vehicleId, workOrderId: { not: wo.id } },
    orderBy: { workDate: "desc" },
    take: 3,
  });
  return {
    ...workOrderDetailDto(wo, flags),
    driver: { id: wo.driver.id, driverCode: wo.driver.driverCode, fullName: wo.driver.fullName, phone: wo.driver.phone },
    customerId: wo.customerId,
    vehicleId: wo.vehicleId,
    createdBy: wo.createdBy.displayName,
    cancelReason: wo.cancelReason,
    attachmentsDetail: wo.attachments.map((a) => ({ id: a.attachment.id, code: a.attachment.code, name: a.attachment.name, type: a.attachment.type, chargeable: a.attachment.chargeable, notes: a.attachment.notes })),
    reviews: wo.reviews.map((r) => ({
      decision: r.decision,
      reason: r.reason,
      correctionTarget: r.correctionTarget,
      computedHours: r.computedHours.toFixed(1),
      approvedHours: r.approvedHours?.toFixed(1) ?? null,
      adjustmentKind: r.adjustmentKind,
      adjustmentReason: r.adjustmentReason,
      breakerHours: r.breakerHours?.toFixed(1) ?? null,
      reviewer: nameOf[r.reviewerId] ?? "Unknown",
      createdAt: r.createdAt.toISOString(),
    })),
    ledger: wo.approved
      ? {
          approvedHours: wo.approved.approvedHours.toFixed(1),
          breakerHours: wo.approved.breakerHours.toFixed(1),
          compensationMethod: wo.approved.compensationMethod,
          driverRate: wo.approved.driverRate?.toFixed(2) ?? null,
          driverAmount: wo.approved.driverAmount.toFixed(2),
          invoice: wo.approved.invoice ? { id: wo.approved.invoice.id, number: wo.approved.invoice.number, status: wo.approved.invoice.status } : null,
          payrollRunId: wo.approved.payrollRunId,
        }
      : null,
    vehicleHistory: history.map((h) => ({ workDate: dateOnlyString(h.workDate), startMeter: h.startMeter.toFixed(1), endMeter: h.endMeter.toFixed(1), approvedHours: h.approvedHours.toFixed(1) })),
  };
}
