// Meter review: approve or reject a driver's submission.
import type { CorrectionTarget, MeterAdjustmentKind, Prisma } from "@prisma/client";
import type { Db } from "../db.js";
import { compensationOn, hourlyDriverAmount, type Compensation } from "../domain/payroll.js";
import { dateOnlyString } from "../domain/time.js";
import { parseTenths, tenthsToString, type Tenths } from "../domain/units.js";
import { canTransition } from "../domain/workOrderStatus.js";
import { audit } from "../lib/audit.js";
import { hoursDec, moneyDec, toPaise, toTenths } from "../lib/dec.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { getMeterThresholds } from "../lib/settings.js";
import { type AdminActor, assertCan } from "./actor.js";
import { activeReadings, currentFlags, workOrderInclude } from "./serialize.js";

export type ReviewInput =
  | {
      decision: "APPROVED";
      note?: string;
      /** Breaker hours to bill. Defaults to the approved hours when a chargeable attachment was assigned, else 0. */
      breakerHours?: string;
      /** Authorized correction: approve hours other than end − start (meter rollover, replaced meter, admin correction). */
      adjustment?: { kind: MeterAdjustmentKind; approvedHours: string; reason: string };
    }
  | { decision: "REJECTED"; reason: string; correctionTarget: CorrectionTarget };

export async function compensationHistory(db: Db | Prisma.TransactionClient, driverId: string): Promise<Compensation[]> {
  const rows = await db.driverCompensation.findMany({ where: { driverId } });
  return rows.map((r) =>
    r.method === "HOURLY"
      ? { method: "HOURLY", hourlyRate: toPaise(r.hourlyRate), effectiveFrom: dateOnlyString(r.effectiveFrom) }
      : { method: "FIXED", monthlySalary: toPaise(r.monthlySalary), effectiveFrom: dateOnlyString(r.effectiveFrom) },
  );
}

export async function reviewSubmission(db: Db, actor: AdminActor, workOrderId: string, input: ReviewInput) {
  assertCan(actor, "METER_APPROVAL");
  if (input.decision === "APPROVED" && input.adjustment) assertCan(actor, "METER_CORRECTION");

  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: { ...workOrderInclude, driver: true },
  });
  if (!wo) throw notFound("Work order");
  if (wo.driver.userId === actor.userId) throw forbidden("You cannot review your own meter submission.");

  const to = input.decision === "APPROVED" ? "APPROVED" : "CORRECTION_REQUIRED";
  if (!canTransition(wo.status, to, "admin")) throw conflict("INVALID_STATE", "Only submissions pending approval can be reviewed.");

  const { start, end } = activeReadings(wo.readings);
  if (!start || !end) throw conflict("INCOMPLETE_SUBMISSION", "Both starting and ending readings are required.");
  const computed = toTenths(end.value) - toTenths(start.value);
  const baseline = await db.approvedWork.aggregate({
    where: { vehicleId: wo.vehicleId, workDate: { lte: wo.workDate }, workOrderId: { not: wo.id } },
    _max: { endMeter: true },
  });
  const flags = currentFlags(wo, await getMeterThresholds(db), baseline._max.endMeter ? toTenths(baseline._max.endMeter) : null);

  if (input.decision === "REJECTED" && input.reason.trim().length < 5) {
    throw badRequest("REASON_REQUIRED", "Give the driver a reason of at least 5 characters.");
  }

  let approved: Tenths = computed;
  let breaker: { attachmentId: string | null; hours: Tenths } = { attachmentId: null, hours: 0 };
  let pay: { method: "HOURLY" | "FIXED"; rate: number | null; amount: number } | null = null;

  if (input.decision === "APPROVED") {
    if (input.adjustment) {
      const h = parseTenths(input.adjustment.approvedHours);
      if (h === null) throw badRequest("INVALID_HOURS", "Approved hours must be a non-negative number with at most one decimal.");
      if (input.adjustment.reason.trim().length < 10) throw badRequest("REASON_REQUIRED", "Explain the correction in at least 10 characters.");
      if (h === computed) throw badRequest("NO_ADJUSTMENT", "These hours equal end − start. Approve without a correction.");
      approved = h;
    } else if (computed < 0) {
      throw conflict(
        "NEGATIVE_HOURS",
        "The ending reading is below the starting reading. Reject it for correction, or approve with an authorized rollover or meter-replacement correction.",
      );
    }

    const chargeable = wo.attachments.filter((a) => a.attachment.chargeable);
    const requested = input.breakerHours !== undefined ? parseTenths(input.breakerHours) : chargeable.length > 0 ? approved : 0;
    if (requested === null || requested > approved) throw badRequest("INVALID_BREAKER_HOURS", "Breaker hours must be between 0 and the approved hours.");
    if (requested > 0 && chargeable.length === 0) throw badRequest("NO_BREAKER", "No chargeable attachment was assigned to this job.");
    breaker = { attachmentId: requested > 0 ? chargeable[0]!.attachmentId : null, hours: requested };

    const workDate = dateOnlyString(wo.workDate);
    const comp = compensationOn(await compensationHistory(db, wo.driverId), workDate);
    if (!comp) throw conflict("COMPENSATION_MISSING", `No pay terms are configured for ${wo.driver.fullName} on ${workDate}.`);
    const { rate, amount } = hourlyDriverAmount(comp, approved);
    pay = { method: comp.method, rate, amount };
  }

  await db.$transaction(async (tx) => {
    const res = await tx.workOrder.updateMany({ where: { id: wo.id, status: wo.status }, data: { status: to, reviewedAt: new Date() } });
    if (res.count !== 1) throw conflict("STATUS_CHANGED", "This submission was already reviewed.");

    const adjustment = input.decision === "APPROVED" ? input.adjustment : undefined;
    const review = await tx.meterReview.create({
      data: {
        workOrderId: wo.id,
        decision: input.decision,
        correctionTarget: input.decision === "REJECTED" ? input.correctionTarget : null,
        reason: input.decision === "REJECTED" ? input.reason.trim() : input.note?.trim() || null,
        startReadingId: start.id,
        endReadingId: end.id,
        computedHours: hoursDec(computed),
        approvedHours: input.decision === "APPROVED" ? hoursDec(approved) : null,
        adjustmentKind: adjustment?.kind ?? null,
        adjustmentReason: adjustment?.reason.trim() ?? null,
        breakerHours: input.decision === "APPROVED" ? hoursDec(breaker.hours) : null,
        flagsAtReview: flags,
        reviewerId: actor.userId,
      },
    });
    await tx.workOrderEvent.create({
      data: { workOrderId: wo.id, fromStatus: wo.status, toStatus: to, actorId: actor.userId, note: review.reason },
    });

    if (pay) {
      // workOrderId and reviewId are unique, so the same work can never enter the ledger twice.
      await tx.approvedWork.create({
        data: {
          workOrderId: wo.id,
          reviewId: review.id,
          driverId: wo.driverId,
          vehicleId: wo.vehicleId,
          customerId: wo.customerId,
          workDate: wo.workDate,
          startMeter: start.value,
          endMeter: end.value,
          approvedHours: hoursDec(approved),
          breakerAttachmentId: breaker.attachmentId,
          breakerHours: hoursDec(breaker.hours),
          compensationMethod: pay.method,
          driverRate: pay.rate === null ? null : moneyDec(pay.rate),
          driverAmount: moneyDec(pay.amount),
        },
      });
      // A replaced meter starts a new baseline; otherwise keep the highest approved reading.
      const newBaseline = adjustment?.kind === "METER_REPLACED" || !wo.vehicle.lastApprovedMeter || wo.vehicle.lastApprovedMeter.lessThan(end.value);
      if (newBaseline) await tx.vehicle.update({ where: { id: wo.vehicleId }, data: { lastApprovedMeter: end.value } });
    }

    await audit(tx, {
      actorId: actor.userId,
      action: input.decision === "APPROVED" ? (adjustment ? "meter_review.approved_with_correction" : "meter_review.approved") : "meter_review.rejected",
      entityType: "WorkOrder",
      entityId: wo.id,
      before: { computedHours: tenthsToString(computed), flags },
      after: {
        reviewId: review.id,
        approvedHours: input.decision === "APPROVED" ? tenthsToString(approved) : null,
        breakerHours: tenthsToString(breaker.hours),
        adjustmentKind: adjustment?.kind ?? null,
        correctionTarget: review.correctionTarget,
      },
      reason: review.reason ?? adjustment?.reason ?? undefined,
    });
    await tx.notification.create({
      data:
        input.decision === "APPROVED"
          ? {
              userId: wo.driver.userId,
              type: "READING_APPROVED",
              title: `${tenthsToString(approved)} hours approved: ${wo.code}`,
              body: adjustment
                ? `Approved with a correction (${adjustment.kind.toLowerCase().replace("_", " ")}): ${adjustment.reason.trim()}`
                : "Your meter readings were approved. These hours will be included in payroll.",
              workOrderId: wo.id,
            }
          : { userId: wo.driver.userId, type: "READING_REJECTED", title: `Correction needed: ${wo.code}`, body: input.reason.trim(), workOrderId: wo.id },
    });
  });
}

