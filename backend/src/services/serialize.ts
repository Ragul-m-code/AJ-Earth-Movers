import type { Prisma } from "@prisma/client";
import type { MeterThresholds } from "../domain/meter.js";
import { endReadingFlags, startReadingFlags } from "../domain/meter.js";
import { dateOnlyString } from "../domain/time.js";
import { parseTenths, tenthsToString } from "../domain/units.js";

export const workOrderInclude = {
  customer: true,
  vehicle: true,
  attachments: { include: { attachment: true } },
  readings: { orderBy: [{ kind: "asc" }, { revision: "asc" }] },
  reviews: { orderBy: { createdAt: "asc" } },
  approved: true,
} satisfies Prisma.WorkOrderInclude;

export const workOrderDetailInclude = {
  ...workOrderInclude,
  events: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.WorkOrderInclude;

type WorkOrderRow = Prisma.WorkOrderGetPayload<{ include: typeof workOrderInclude }>;
type WorkOrderDetailRow = Prisma.WorkOrderGetPayload<{ include: typeof workOrderDetailInclude }>;
type ReadingRow = WorkOrderRow["readings"][number];

const tenths = (d: Prisma.Decimal) => parseTenths(d.toFixed(1))!;

/** The current (highest-revision) reading of each kind. Older revisions are kept for audit. */
export function activeReadings(readings: ReadingRow[]) {
  let start: ReadingRow | null = null;
  let end: ReadingRow | null = null;
  for (const r of readings) {
    if (r.kind === "START" && (!start || r.revision > start.revision)) start = r;
    if (r.kind === "END" && (!end || r.revision > end.revision)) end = r;
  }
  return { start, end };
}

/** Which readings the driver still has to resubmit after a rejection. */
export function correctionNeeds(wo: Pick<WorkOrderRow, "status" | "reviews" | "readings">) {
  if (wo.status !== "CORRECTION_REQUIRED") return { start: false, end: false };
  const review = [...wo.reviews].reverse().find((r) => r.decision === "REJECTED");
  if (!review) return { start: false, end: false };
  const resubmitted = (kind: "START" | "END") =>
    wo.readings.some((r) => r.kind === kind && r.submittedAt > review.createdAt);
  const target = review.correctionTarget ?? "BOTH";
  return {
    start: (target === "START" || target === "BOTH") && !resubmitted("START"),
    end: (target === "END" || target === "BOTH") && !resubmitted("END"),
  };
}

/**
 * When the work actually started and ended: the first submission of each kind.
 * A correction submitted days later must not distort the elapsed-time check.
 */
export function originalSubmissionTimes(readings: ReadingRow[]) {
  const first = (kind: "START" | "END") => readings.find((r) => r.kind === kind && r.revision === 1)?.submittedAt ?? null;
  return { startAt: first("START"), endAt: first("END") };
}

export function currentFlags(wo: WorkOrderRow, thresholds: MeterThresholds, vehicleLastApprovedBefore: number | null) {
  const { start, end } = activeReadings(wo.readings);
  if (!start) return [];
  const flags: string[] = [...startReadingFlags(tenths(start.value), vehicleLastApprovedBefore)];
  if (end) {
    const times = originalSubmissionTimes(wo.readings);
    flags.push(
      ...endReadingFlags({
        start: tenths(start.value),
        end: tenths(end.value),
        startSubmittedAt: times.startAt ?? start.submittedAt,
        endSubmittedAt: times.endAt ?? end.submittedAt,
        thresholds,
      }),
    );
  }
  return flags;
}

function readingDto(r: ReadingRow) {
  return {
    id: r.id,
    kind: r.kind,
    revision: r.revision,
    value: r.value.toFixed(1),
    photoUrl: `/api/photos/${r.photoId}`,
    note: r.note,
    flags: r.flags,
    submittedAt: r.submittedAt.toISOString(),
    supersedesId: r.supersedesId,
  };
}

export function workOrderSummaryDto(wo: WorkOrderRow) {
  const { start, end } = activeReadings(wo.readings);
  const latestReview = wo.reviews.at(-1) ?? null;
  const needs = correctionNeeds(wo);
  return {
    id: wo.id,
    code: wo.code,
    status: wo.status,
    workDate: dateOnlyString(wo.workDate),
    shiftLabel: wo.shiftLabel,
    siteName: wo.siteName,
    siteAddress: wo.siteAddress,
    customer: { name: wo.customer.name },
    vehicle: {
      unitCode: wo.vehicle.unitCode,
      registrationNo: wo.vehicle.registrationNo,
      make: wo.vehicle.make,
      model: wo.vehicle.model,
      category: wo.vehicle.category,
    },
    attachments: wo.attachments.map((a) => ({ code: a.attachment.code, name: a.attachment.name, type: a.attachment.type })),
    plannedHours: wo.plannedHours?.toFixed(1) ?? null,
    start: start ? readingDto(start) : null,
    end: end ? readingDto(end) : null,
    operatingHours: start && end ? tenthsToString(tenths(end.value) - tenths(start.value)) : null,
    latestReview: latestReview
      ? {
          decision: latestReview.decision,
          reason: latestReview.reason,
          correctionTarget: latestReview.correctionTarget,
          createdAt: latestReview.createdAt.toISOString(),
        }
      : null,
    correctionNeeded: needs,
    approved: wo.approved
      ? {
          hours: wo.approved.approvedHours.toFixed(1),
          driverRate: wo.approved.driverRate?.toFixed(2) ?? null,
          compensationMethod: wo.approved.compensationMethod,
          driverAmount: wo.approved.driverAmount.toFixed(2),
          inPayroll: wo.approved.payrollRunId !== null,
        }
      : null,
    submittedAt: wo.submittedAt?.toISOString() ?? null,
    reviewedAt: wo.reviewedAt?.toISOString() ?? null,
  };
}

export function workOrderDetailDto(wo: WorkOrderDetailRow, flags: string[]) {
  return {
    ...workOrderSummaryDto(wo),
    flags,
    instructions: wo.instructions,
    siteContactName: wo.siteContactName,
    siteContactPhone: wo.siteContactPhone,
    declineReason: wo.declineReason,
    vehicleNotes: wo.vehicle.notes,
    /** Reference for the driver when entering a starting reading. */
    vehicleLastApprovedMeter: wo.vehicle.lastApprovedMeter?.toFixed(1) ?? null,
    attachmentsDetail: wo.attachments.map((a) => ({
      code: a.attachment.code,
      name: a.attachment.name,
      type: a.attachment.type,
      notes: a.attachment.notes,
    })),
    readings: wo.readings.map(readingDto),
    reviews: wo.reviews.map((r) => ({
      decision: r.decision,
      reason: r.reason,
      correctionTarget: r.correctionTarget,
      computedHours: r.computedHours.toFixed(1),
      approvedHours: r.approvedHours?.toFixed(1) ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    events: wo.events.map((e) => ({
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
