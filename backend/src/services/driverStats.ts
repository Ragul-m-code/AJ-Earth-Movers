import type { Db } from "../db.js";
import { workingDays } from "../domain/pay.js";
import { dateOnly, dateOnlyString, istDateString, monthRange } from "../domain/time.js";
import { paiseToString, parsePaise, parseTenths, tenthsToString } from "../domain/units.js";
import type { DriverActor } from "./workOrders.js";
import { activeReadings } from "./serialize.js";

/**
 * Month summary for the driver. "Approved" figures come only from the ApprovedWork ledger.
 * "Pending" hours are submitted-but-unreviewed and are never shown as earnings.
 */
export async function driverMonthSummary(db: Db, actor: DriverActor, month: string) {
  const { start, end } = monthRange(month);
  const range = { gte: dateOnly(start), lte: dateOnly(end) };

  const [approved, pending] = await Promise.all([
    db.approvedWork.findMany({ where: { driverId: actor.driverId, workDate: range }, orderBy: { workDate: "asc" } }),
    db.workOrder.findMany({
      where: { driverId: actor.driverId, workDate: range, status: { in: ["PENDING_APPROVAL", "CORRECTION_REQUIRED"] } },
      include: { readings: true },
    }),
  ]);

  const days = new Map<string, { approvedHours: number; pendingHours: number; approvedJobs: number; pendingJobs: number }>();
  const day = (d: string) => {
    let v = days.get(d);
    if (!v) days.set(d, (v = { approvedHours: 0, pendingHours: 0, approvedJobs: 0, pendingJobs: 0 }));
    return v;
  };

  let approvedHours = 0;
  let approvedAmount = 0;
  for (const w of approved) {
    const h = parseTenths(w.approvedHours.toFixed(1))!;
    approvedHours += h;
    approvedAmount += parsePaise(w.driverAmount.toFixed(2))!;
    const d = day(dateOnlyString(w.workDate));
    d.approvedHours += h;
    d.approvedJobs += 1;
  }

  let pendingHours = 0;
  for (const wo of pending) {
    const { start: s, end: e } = activeReadings(wo.readings);
    const h = s && e ? Math.max(0, parseTenths(e.value.toFixed(1))! - parseTenths(s.value.toFixed(1))!) : 0;
    pendingHours += h;
    const d = day(dateOnlyString(wo.workDate));
    d.pendingHours += h;
    d.pendingJobs += 1;
  }

  return {
    month,
    approvedHours: tenthsToString(approvedHours),
    pendingHours: tenthsToString(pendingHours),
    workingDays: workingDays(approved.map((w) => dateOnlyString(w.workDate))),
    approvedJobs: approved.length,
    pendingJobs: pending.length,
    approvedEarnings: paiseToString(approvedAmount),
    days: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        approvedHours: tenthsToString(v.approvedHours),
        pendingHours: tenthsToString(v.pendingHours),
        approvedJobs: v.approvedJobs,
        pendingJobs: v.pendingJobs,
      })),
  };
}

export async function driverEarnings(db: Db, actor: DriverActor) {
  const [runs, unpaid, history] = await Promise.all([
    // Draft payroll is not yet authorized, so drivers only see approved and paid runs.
    db.payrollRun.findMany({
      where: { driverId: actor.driverId, status: { in: ["APPROVED", "PAID"] } },
      include: { adjustments: { where: { status: "APPROVED" } } },
      orderBy: { periodStart: "desc" },
    }),
    db.approvedWork.findMany({ where: { driverId: actor.driverId, payrollRunId: null }, orderBy: { workDate: "asc" } }),
    db.driverCompensation.findMany({ where: { driverId: actor.driverId }, orderBy: { effectiveFrom: "desc" }, take: 10 }),
  ]);
  const today = istDateString(new Date());
  const current = history.find((c) => dateOnlyString(c.effectiveFrom) <= today) ?? null;
  const compDto = (c: (typeof history)[number]) => ({
    method: c.method,
    hourlyRate: c.hourlyRate?.toFixed(2) ?? null,
    monthlySalary: c.monthlySalary?.toFixed(2) ?? null,
    effectiveFrom: dateOnlyString(c.effectiveFrom),
  });

  const unpaidHours = unpaid.reduce((s, w) => s + parseTenths(w.approvedHours.toFixed(1))!, 0);
  const unpaidAmount = unpaid.reduce((s, w) => s + parsePaise(w.driverAmount.toFixed(2))!, 0);

  return {
    compensation: current ? compDto(current) : null,
    compensationHistory: history.map(compDto),
    notYetInPayroll: {
      hours: tenthsToString(unpaidHours),
      amount: paiseToString(unpaidAmount),
      jobs: unpaid.length,
      workingDays: workingDays(unpaid.map((w) => dateOnlyString(w.workDate))),
    },
    payrolls: runs.map((r) => ({
      id: r.id,
      periodStart: dateOnlyString(r.periodStart),
      periodEnd: dateOnlyString(r.periodEnd),
      status: r.status,
      method: r.method,
      fixedSalary: r.fixedSalary?.toFixed(2) ?? null,
      approvedHours: r.approvedHours.toFixed(1),
      workingDays: r.workingDays,
      grossAmount: r.grossAmount.toFixed(2),
      additionsTotal: r.additionsTotal.toFixed(2),
      deductionsTotal: r.deductionsTotal.toFixed(2),
      netAmount: r.netAmount.toFixed(2),
      paidAt: r.paidAt?.toISOString() ?? null,
      paymentMode: r.paymentMode,
      paymentRef: r.paymentRef,
      adjustments: r.adjustments.map((a) => ({
        kind: a.kind,
        amount: a.amount.toFixed(2),
        description: a.description,
        effectiveOn: dateOnlyString(a.effectiveOn),
      })),
    })),
  };
}
