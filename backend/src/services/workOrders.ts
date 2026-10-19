import { Prisma, type MeterKind, type WorkOrderStatus } from "@prisma/client";
import type { Db, Tx } from "../db.js";
import { endReadingFlags, startReadingFlags } from "../domain/meter.js";
import { dateOnly } from "../domain/time.js";
import { parseTenths, tenthsToString } from "../domain/units.js";
import { canTransition } from "../domain/workOrderStatus.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { getMeterThresholds } from "../lib/settings.js";
import { sniffImageType, type PhotoStorage } from "../lib/storage.js";
import { checkStorageAlert } from "./storageUsage.js";
import {
  activeReadings,
  correctionNeeds,
  currentFlags,
  originalSubmissionTimes,
  workOrderDetailDto,
  workOrderDetailInclude,
  workOrderInclude,
  workOrderSummaryDto,
} from "./serialize.js";

export interface DriverActor {
  userId: string;
  driverId: string;
}

const LIST_GROUPS: Record<string, WorkOrderStatus[]> = {
  active: ["ACCEPTED", "IN_PROGRESS"],
  assigned: ["ASSIGNED"],
  action: ["CORRECTION_REQUIRED"],
  pending: ["PENDING_APPROVAL"],
  approved: ["APPROVED"],
  closed: ["DECLINED", "CANCELLED"],
};
export const LIST_GROUP_NAMES = Object.keys(LIST_GROUPS);

export async function listDriverWorkOrders(
  db: Db,
  actor: DriverActor,
  query: { group?: string; from?: string; to?: string; q?: string; page: number; pageSize: number },
) {
  const where: Prisma.WorkOrderWhereInput = { driverId: actor.driverId };
  if (query.group) where.status = { in: LIST_GROUPS[query.group] ?? [] };
  if (query.from || query.to) {
    where.workDate = {
      ...(query.from ? { gte: dateOnly(query.from) } : {}),
      ...(query.to ? { lte: dateOnly(query.to) } : {}),
    };
  }
  if (query.q) {
    const q = query.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { siteName: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { vehicle: { registrationNo: { contains: q, mode: "insensitive" } } },
      { vehicle: { model: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [rows, total, counts] = await Promise.all([
    db.workOrder.findMany({
      where,
      include: workOrderInclude,
      orderBy: [{ workDate: "desc" }, { assignedAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.workOrder.count({ where }),
    db.workOrder.groupBy({ by: ["status"], where: { driverId: actor.driverId }, _count: true }),
  ]);

  const statusCounts = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const groupCounts = Object.fromEntries(
    Object.entries(LIST_GROUPS).map(([g, statuses]) => [g, statuses.reduce((s, st) => s + (statusCounts[st] ?? 0), 0)]),
  );
  return { items: rows.map(workOrderSummaryDto), total, page: query.page, pageSize: query.pageSize, groupCounts };
}

/** Highest approved ending meter for this vehicle from other jobs on or before workDate. */
async function vehicleBaseline(db: Db | Tx, vehicleId: string, workDate: Date, excludeWorkOrderId: string) {
  const agg = await db.approvedWork.aggregate({
    where: { vehicleId, workDate: { lte: workDate }, workOrderId: { not: excludeWorkOrderId } },
    _max: { endMeter: true },
  });
  return agg._max.endMeter ? parseTenths(agg._max.endMeter.toFixed(1)) : null;
}

async function loadOwned(db: Db | Tx, actor: DriverActor, id: string) {
  const wo = await db.workOrder.findFirst({ where: { id, driverId: actor.driverId }, include: workOrderDetailInclude });
  // Another driver's work order is reported as not found, so ids cannot be probed.
  if (!wo) throw notFound("Work order");
  return wo;
}

export async function getDriverWorkOrder(db: Db, actor: DriverActor, id: string) {
  const wo = await loadOwned(db, actor, id);
  const thresholds = await getMeterThresholds(db);
  const flags =
    wo.status === "APPROVED"
      ? (wo.reviews.at(-1)?.flagsAtReview ?? [])
      : currentFlags(wo, thresholds, await vehicleBaseline(db, wo.vehicleId, wo.workDate, wo.id));
  return workOrderDetailDto(wo, flags);
}

async function transition(
  tx: Tx,
  args: { workOrderId: string; from: WorkOrderStatus; to: WorkOrderStatus; actorId: string; note?: string; data?: Prisma.WorkOrderUpdateManyMutationInput },
) {
  // Conditional update: if another request changed the status first, nothing is updated and we report a conflict.
  const res = await tx.workOrder.updateMany({
    where: { id: args.workOrderId, status: args.from },
    data: { ...args.data, status: args.to },
  });
  if (res.count !== 1) throw conflict("STATUS_CHANGED", "This job was updated elsewhere. Refresh and try again.");
  await tx.workOrderEvent.create({
    data: { workOrderId: args.workOrderId, fromStatus: args.from, toStatus: args.to, actorId: args.actorId, note: args.note },
  });
}

export async function respondToAssignment(
  db: Db,
  actor: DriverActor,
  id: string,
  response: { accept: true } | { accept: false; reason: string },
) {
  const wo = await loadOwned(db, actor, id);
  const to: WorkOrderStatus = response.accept ? "ACCEPTED" : "DECLINED";
  if (!canTransition(wo.status, to, "driver")) {
    throw conflict("INVALID_STATE", response.accept ? "This job can no longer be accepted." : "This job can no longer be declined.");
  }
  await db.$transaction(async (tx) => {
    await transition(tx, {
      workOrderId: id,
      from: wo.status,
      to,
      actorId: actor.userId,
      note: response.accept ? undefined : response.reason,
      data: { respondedAt: new Date(), declineReason: response.accept ? null : response.reason },
    });
    await audit(tx, {
      actorId: actor.userId,
      action: response.accept ? "work_order.accepted" : "work_order.declined",
      entityType: "WorkOrder",
      entityId: id,
      reason: response.accept ? undefined : response.reason,
    });
  });
  return getDriverWorkOrder(db, actor, id);
}

interface ReadingPlan {
  kind: MeterKind;
  revision: number;
  supersedesId: string | null;
  nextStatus: WorkOrderStatus;
  isCorrection: boolean;
}

type LoadedWorkOrder = Awaited<ReturnType<typeof loadOwned>>;

/** Decides whether a reading of this kind is allowed now, and what it does to the job's status. */
function planReading(wo: LoadedWorkOrder, kind: MeterKind): ReadingPlan {
  const { start, end } = activeReadings(wo.readings);
  if (wo.status === "ACCEPTED" && kind === "START" && !start) {
    return { kind, revision: 1, supersedesId: null, nextStatus: "IN_PROGRESS", isCorrection: false };
  }
  if (wo.status === "IN_PROGRESS" && kind === "END" && start && !end) {
    return { kind, revision: 1, supersedesId: null, nextStatus: "PENDING_APPROVAL", isCorrection: false };
  }
  if (wo.status === "CORRECTION_REQUIRED") {
    const needs = correctionNeeds(wo);
    const current = kind === "START" ? start : end;
    if ((kind === "START" ? needs.start : needs.end) && current) {
      const stillNeedsOther = kind === "START" ? needs.end : needs.start;
      return {
        kind,
        revision: current.revision + 1,
        supersedesId: current.id,
        nextStatus: stillNeedsOther ? "CORRECTION_REQUIRED" : "PENDING_APPROVAL",
        isCorrection: true,
      };
    }
  }
  const messages: Partial<Record<WorkOrderStatus, string>> = {
    ASSIGNED: "Accept the job before recording meter readings.",
    PENDING_APPROVAL: "This job is waiting for admin approval. Readings cannot be changed now.",
    APPROVED: "This job is approved. Readings cannot be changed.",
    DECLINED: "This job was declined.",
    CANCELLED: "This job was cancelled.",
  };
  throw conflict(
    "READING_NOT_ALLOWED",
    messages[wo.status] ?? `A ${kind === "START" ? "starting" : "ending"} reading is not expected for this job right now.`,
  );
}

async function computeFlags(db: Db | Tx, wo: LoadedWorkOrder, plan: ReadingPlan, value: number, at: Date) {
  const thresholds = await getMeterThresholds(db);
  const { start, end } = activeReadings(wo.readings);
  const original = originalSubmissionTimes(wo.readings);
  const startValue = plan.kind === "START" ? value : parseTenths(start!.value.toFixed(1))!;
  const startAt = original.startAt ?? at;
  const flags: string[] = [];
  if (plan.kind === "START") {
    flags.push(...startReadingFlags(value, await vehicleBaseline(db, wo.vehicleId, wo.workDate, wo.id)));
  }
  // An end value exists either because this is the end reading, or because a start correction re-pairs with it.
  const endValue = plan.kind === "END" ? value : end ? parseTenths(end.value.toFixed(1))! : null;
  const endAt = original.endAt ?? (plan.kind === "END" ? at : undefined);
  if (endValue !== null && endAt && !(plan.kind === "START" && plan.nextStatus === "CORRECTION_REQUIRED")) {
    flags.push(...endReadingFlags({ start: startValue, end: endValue, startSubmittedAt: startAt, endSubmittedAt: endAt, thresholds }));
  }
  const hours = endValue !== null ? tenthsToString(endValue - startValue) : null;
  return { flags, hours };
}

/** Dry run used by the review screen: the same validation and flags as a real submission, without saving. */
export async function checkReading(db: Db, actor: DriverActor, id: string, input: { kind: MeterKind; value: string }) {
  const value = parseTenths(input.value);
  if (value === null) throw badRequest("INVALID_METER_VALUE", "Enter the meter reading as a number with at most one decimal, e.g. 1259.5.");
  const wo = await loadOwned(db, actor, id);
  const plan = planReading(wo, input.kind);
  return computeFlags(db, wo, plan, value, new Date());
}

export interface SubmitReadingInput {
  kind: MeterKind;
  value: string;
  note?: string;
  idempotencyKey: string;
  photo: Buffer;
}

export async function submitReading(db: Db, storage: PhotoStorage, actor: DriverActor, id: string, input: SubmitReadingInput) {
  // Retry of a request the server already processed: return the stored result instead of recording twice.
  const existing = await db.meterReading.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.workOrderId !== id || existing.kind !== input.kind || existing.value.toFixed(1) !== tenthsToString(parseTenths(input.value) ?? -1)) {
      throw conflict("IDEMPOTENCY_KEY_REUSED", "This submission key was already used for a different reading. Start the submission again.");
    }
    return { replayed: true, workOrder: await getDriverWorkOrder(db, actor, id) };
  }

  const value = parseTenths(input.value);
  if (value === null) throw badRequest("INVALID_METER_VALUE", "Enter the meter reading as a number with at most one decimal, e.g. 1259.5.");
  const image = sniffImageType(input.photo);
  if (!image) throw badRequest("INVALID_PHOTO", "The meter photo must be a JPEG, PNG, WebP or HEIC image.");

  const wo = await loadOwned(db, actor, id);
  const plan = planReading(wo, input.kind);
  const now = new Date();
  const { flags } = await computeFlags(db, wo, plan, value, now);

  const stored = await storage.put(input.photo, image.ext);
  try {
    await db.$transaction(async (tx) => {
      const photo = await tx.photo.create({
        data: {
          workOrderId: id,
          storageKey: stored.key,
          mimeType: image.mime,
          sizeBytes: input.photo.length,
          sha256: stored.sha256,
          uploadedById: actor.userId,
        },
      });
      const reading = await tx.meterReading.create({
        data: {
          workOrderId: id,
          kind: plan.kind,
          revision: plan.revision,
          value: new Prisma.Decimal(tenthsToString(value)),
          photoId: photo.id,
          supersedesId: plan.supersedesId,
          note: input.note?.trim() || null,
          flags,
          submittedById: actor.userId,
          submittedAt: now,
          idempotencyKey: input.idempotencyKey,
        },
      });
      const data: Prisma.WorkOrderUpdateManyMutationInput = {};
      if (plan.kind === "START" && !plan.isCorrection) data.startedAt = now;
      if (plan.nextStatus === "PENDING_APPROVAL") data.submittedAt = now;

      if (plan.nextStatus !== wo.status) {
        await transition(tx, {
          workOrderId: id,
          from: wo.status,
          to: plan.nextStatus,
          actorId: actor.userId,
          note: plan.isCorrection ? `Corrected ${plan.kind.toLowerCase()} reading` : undefined,
          data,
        });
      } else {
        // Partial correction (one of two readings resubmitted): status unchanged, but guard against concurrent changes.
        const res = await tx.workOrder.updateMany({ where: { id, status: wo.status }, data: { updatedAt: now } });
        if (res.count !== 1) throw conflict("STATUS_CHANGED", "This job was updated elsewhere. Refresh and try again.");
      }
      await audit(tx, {
        actorId: actor.userId,
        action: plan.isCorrection ? "meter_reading.corrected" : "meter_reading.submitted",
        entityType: "MeterReading",
        entityId: reading.id,
        after: { workOrderId: id, kind: plan.kind, revision: plan.revision, value: tenthsToString(value), flags, supersedesId: plan.supersedesId },
      });
      if (plan.nextStatus === "PENDING_APPROVAL") {
        await tx.notification.create({
          data: {
            userId: actor.userId,
            type: "SUBMISSION_RECEIVED",
            title: `Submitted for approval: ${wo.code}`,
            body: "The server received your meter readings and photos. An admin will review them.",
            workOrderId: id,
          },
        });
        // Tell everyone who can approve meter readings.
        const reviewers = await tx.user.findMany({
          where: { status: "ACTIVE", OR: [{ role: "OWNER" }, { permissions: { some: { module: "METER_APPROVAL" } } }] },
          select: { id: true },
        });
        if (reviewers.length) {
          await tx.notification.createMany({
            data: reviewers.map((r) => ({
              userId: r.id,
              type: "METER_SUBMITTED" as const,
              title: `${plan.isCorrection ? "Corrected reading" : "Meter readings"} to review: ${wo.code}`,
              body: `${wo.vehicle.make} ${wo.vehicle.model} (${wo.vehicle.unitCode}) · ${wo.siteName}${flags.length ? ` · ${flags.length} flag(s)` : ""}`,
              workOrderId: id,
            })),
          });
        }
      }
    });
  } catch (err) {
    await storage.remove(stored.key).catch(() => undefined);
    // Two identical retries raced: the other one won, so report its result.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await db.meterReading.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (winner) return { replayed: true, workOrder: await getDriverWorkOrder(db, actor, id) };
    }
    throw err;
  }
  // Best effort: a monitoring failure must never fail the driver's submission.
  await checkStorageAlert(db).catch(() => undefined);
  return { replayed: false, workOrder: await getDriverWorkOrder(db, actor, id) };
}
