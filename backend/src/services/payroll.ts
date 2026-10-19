// Driver payroll: periods, hourly vs fixed salary, authorized adjustments, approval and payment.
import { Prisma, type AdjustmentKind } from "@prisma/client";
import type { Db, Tx } from "../db.js";
import { workingDays } from "../domain/pay.js";
import { compensationForPeriod, isWholeMonth } from "../domain/payroll.js";
import { dateOnly, dateOnlyString } from "../domain/time.js";
import { paiseToString, parsePaise, tenthsToString } from "../domain/units.js";
import { audit } from "../lib/audit.js";
import { hoursDec, moneyDec, toPaise, toTenths } from "../lib/dec.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { type AdminActor, assertCan } from "./actor.js";
import { compensationHistory } from "./review.js";

interface Period {
  start: string;
  end: string;
}

async function gather(db: Db | Tx, driverId: string, p: Period) {
  const range = { gte: dateOnly(p.start), lte: dateOnly(p.end) };
  const [work, adjustments, pendingAdjustments, unapproved, history] = await Promise.all([
    // Only approved work not yet claimed by any payroll run: the guard against paying twice.
    db.approvedWork.findMany({ where: { driverId, workDate: range, payrollRunId: null }, include: { workOrder: true }, orderBy: { workDate: "asc" } }),
    db.salaryAdjustment.findMany({ where: { driverId, effectiveOn: range, status: "APPROVED", payrollRunId: null } }),
    db.salaryAdjustment.count({ where: { driverId, effectiveOn: range, status: "PENDING" } }),
    db.workOrder.count({ where: { driverId, workDate: range, status: { in: ["PENDING_APPROVAL", "CORRECTION_REQUIRED", "IN_PROGRESS"] } } }),
    compensationHistory(db, driverId),
  ]);
  const comp = compensationForPeriod(history, p);
  if ("error" in comp) throw conflict("COMPENSATION_PERIOD", comp.error);
  if (comp.method === "FIXED" && !isWholeMonth(p)) throw badRequest("FIXED_NEEDS_MONTH", "Fixed-salary payroll runs cover one full calendar month.");

  const hours = work.reduce((s, w) => s + toTenths(w.approvedHours), 0);
  // HOURLY: each record carries the rate in force on its work date. FIXED: the configured monthly salary.
  const gross = comp.method === "HOURLY" ? work.reduce((s, w) => s + toPaise(w.driverAmount), 0) : comp.monthlySalary;
  const additions = adjustments.filter((a) => a.kind === "ADDITION").reduce((s, a) => s + toPaise(a.amount), 0);
  const deductions = adjustments.filter((a) => a.kind === "DEDUCTION").reduce((s, a) => s + toPaise(a.amount), 0);
  const days = workingDays(work.map((w) => dateOnlyString(w.workDate)));
  const warnings: string[] = [];
  if (unapproved > 0) warnings.push(`${unapproved} job(s) in this period are not approved yet and are excluded.`);
  if (pendingAdjustments > 0) warnings.push(`${pendingAdjustments} adjustment(s) await approval and are excluded.`);
  if (gross + additions - deductions < 0) throw conflict("NEGATIVE_NET", "Deductions exceed earnings for this period. Review the adjustments.");
  return { comp, work, adjustments, hours, gross, additions, deductions, net: gross + additions - deductions, days, warnings };
}

export async function previewPayroll(db: Db, actor: AdminActor, driverId: string, p: Period) {
  assertCan(actor, "PAYROLL");
  const g = await gather(db, driverId, p);
  return {
    method: g.comp.method,
    hourlyRateNote: g.comp.method === "HOURLY" ? "Each job uses the driver's rate in force on its work date." : null,
    fixedSalary: g.comp.method === "FIXED" ? paiseToString(g.comp.monthlySalary) : null,
    approvedHours: tenthsToString(g.hours),
    workingDays: g.days,
    gross: paiseToString(g.gross),
    additions: paiseToString(g.additions),
    deductions: paiseToString(g.deductions),
    net: paiseToString(g.net),
    jobs: g.work.map((w) => ({ code: w.workOrder.code, workDate: dateOnlyString(w.workDate), hours: w.approvedHours.toFixed(1), rate: w.driverRate?.toFixed(2) ?? null, amount: w.driverAmount.toFixed(2) })),
    adjustments: g.adjustments.map((a) => ({ id: a.id, kind: a.kind, amount: a.amount.toFixed(2), description: a.description })),
    warnings: g.warnings,
  };
}

export async function createPayrollRun(db: Db, actor: AdminActor, driverId: string, p: Period) {
  assertCan(actor, "PAYROLL");
  if (p.end < p.start) throw badRequest("INVALID_PERIOD", "The period end is before its start.");
  const overlap = await db.payrollRun.findFirst({ where: { driverId, periodStart: { lte: dateOnly(p.end) }, periodEnd: { gte: dateOnly(p.start) } } });
  if (overlap) throw conflict("PERIOD_OVERLAP", `A payroll run already covers ${dateOnlyString(overlap.periodStart)} to ${dateOnlyString(overlap.periodEnd)}.`);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-${driverId}`}))`;
      const g = await gather(tx, driverId, p);
      const run = await tx.payrollRun.create({
        data: {
          driverId,
          periodStart: dateOnly(p.start),
          periodEnd: dateOnly(p.end),
          method: g.comp.method,
          fixedSalary: g.comp.method === "FIXED" ? moneyDec(g.comp.monthlySalary) : null,
          approvedHours: hoursDec(g.hours),
          workingDays: g.days,
          grossAmount: moneyDec(g.gross),
          additionsTotal: moneyDec(g.additions),
          deductionsTotal: moneyDec(g.deductions),
          netAmount: moneyDec(g.net),
          createdById: actor.userId,
        },
      });
      // Claim each record only if still unclaimed; a mismatch means another run took it concurrently.
      const ids = g.work.map((w) => w.id);
      const claimed = await tx.approvedWork.updateMany({ where: { id: { in: ids }, payrollRunId: null }, data: { payrollRunId: run.id } });
      if (claimed.count !== ids.length) throw conflict("ALREADY_IN_PAYROLL", "Some work was added to another payroll run. Try again.");
      const adjIds = g.adjustments.map((a) => a.id);
      const adj = await tx.salaryAdjustment.updateMany({ where: { id: { in: adjIds }, payrollRunId: null, status: "APPROVED" }, data: { payrollRunId: run.id } });
      if (adj.count !== adjIds.length) throw conflict("ALREADY_IN_PAYROLL", "An adjustment was added to another payroll run. Try again.");
      await audit(tx, { actorId: actor.userId, action: "payroll.draft_created", entityType: "PayrollRun", entityId: run.id, after: { driverId, periodStart: p.start, periodEnd: p.end, net: paiseToString(g.net), method: g.comp.method } });
      return run;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict("PERIOD_OVERLAP", "A payroll run already exists for this period.");
    throw err;
  }
}

export async function discardDraftRun(db: Db, actor: AdminActor, runId: string) {
  assertCan(actor, "PAYROLL");
  await db.$transaction(async (tx) => {
    const run = await tx.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw notFound("Payroll run");
    if (run.status !== "DRAFT") throw conflict("NOT_DRAFT", "Only draft payroll runs can be discarded.");
    await tx.approvedWork.updateMany({ where: { payrollRunId: runId }, data: { payrollRunId: null } });
    await tx.salaryAdjustment.updateMany({ where: { payrollRunId: runId }, data: { payrollRunId: null } });
    await tx.payrollRun.delete({ where: { id: runId } });
    await audit(tx, { actorId: actor.userId, action: "payroll.draft_discarded", entityType: "PayrollRun", entityId: runId, before: { driverId: run.driverId, net: run.netAmount.toFixed(2) } });
  });
}

export async function approvePayrollRun(db: Db, actor: AdminActor, runId: string) {
  assertCan(actor, "PAYROLL");
  await db.$transaction(async (tx) => {
    const run = await tx.payrollRun.findUnique({ where: { id: runId }, include: { driver: true } });
    if (!run) throw notFound("Payroll run");
    if (run.status !== "DRAFT") return; // already approved: repeated request
    if (run.driver.userId === actor.userId) throw forbidden("You cannot approve your own payroll.");
    const res = await tx.payrollRun.updateMany({ where: { id: runId, status: "DRAFT" }, data: { status: "APPROVED", approvedById: actor.userId, approvedAt: new Date() } });
    if (res.count !== 1) return;
    await audit(tx, { actorId: actor.userId, action: "payroll.approved", entityType: "PayrollRun", entityId: runId, after: { net: run.netAmount.toFixed(2) } });
    await tx.notification.create({ data: { userId: run.driver.userId, type: "PAYROLL_APPROVED", title: "Payroll approved", body: `Net pay ₹${run.netAmount.toFixed(2)} for ${dateOnlyString(run.periodStart)} to ${dateOnlyString(run.periodEnd)}.` } });
  });
}

/** Record the salary payment. Repeating the request does not record a second payment. */
export async function markPayrollPaid(db: Db, actor: AdminActor, runId: string, input: { paidOn: string; mode: string; reference?: string }) {
  assertCan(actor, "PAYROLL");
  await db.$transaction(async (tx) => {
    const run = await tx.payrollRun.findUnique({ where: { id: runId }, include: { driver: true } });
    if (!run) throw notFound("Payroll run");
    if (run.status === "PAID") return;
    if (run.status !== "APPROVED") throw conflict("NOT_APPROVED", "Approve the payroll run before recording payment.");
    const res = await tx.payrollRun.updateMany({
      where: { id: runId, status: "APPROVED" },
      data: { status: "PAID", paidAt: dateOnly(input.paidOn), paymentMode: input.mode, paymentRef: input.reference?.trim() || null, paidById: actor.userId },
    });
    if (res.count !== 1) return;
    await audit(tx, { actorId: actor.userId, action: "payroll.paid", entityType: "PayrollRun", entityId: runId, after: input });
    await tx.notification.create({ data: { userId: run.driver.userId, type: "PAYROLL_PAID", title: "Salary paid", body: `₹${run.netAmount.toFixed(2)} paid via ${input.mode}${input.reference ? ` (ref ${input.reference})` : ""}.` } });
  });
}

export async function createAdjustment(db: Db, actor: AdminActor, driverId: string, input: { kind: AdjustmentKind; amount: string; description: string; effectiveOn: string }) {
  assertCan(actor, "PAYROLL");
  const amount = parsePaise(input.amount);
  if (amount === null || amount <= 0) throw badRequest("INVALID_AMOUNT", "Enter an amount greater than zero.");
  if (input.description.trim().length < 5) throw badRequest("DESCRIPTION_REQUIRED", "Describe the adjustment (at least 5 characters).");
  return db.$transaction(async (tx) => {
    const a = await tx.salaryAdjustment.create({
      data: { driverId, kind: input.kind, amount: moneyDec(amount), description: input.description.trim(), effectiveOn: dateOnly(input.effectiveOn), createdById: actor.userId },
    });
    await audit(tx, { actorId: actor.userId, action: "salary_adjustment.created", entityType: "SalaryAdjustment", entityId: a.id, after: input });
    return a;
  });
}

/** Adjustments need a second person's approval unless the owner raised them. */
export async function decideAdjustment(db: Db, actor: AdminActor, id: string, decision: "APPROVED" | "VOID", reason?: string) {
  assertCan(actor, "PAYROLL");
  await db.$transaction(async (tx) => {
    const a = await tx.salaryAdjustment.findUnique({ where: { id }, include: { driver: true } });
    if (!a) throw notFound("Adjustment");
    if (a.payrollRunId) throw conflict("IN_PAYROLL", "This adjustment is already in a payroll run.");
    if (a.status !== "PENDING" && !(decision === "VOID" && a.status === "APPROVED")) throw conflict("INVALID_STATE", "This adjustment was already decided.");
    if (decision === "APPROVED" && a.createdById === actor.userId && actor.role !== "OWNER") throw forbidden("Another authorized user must approve an adjustment you created.");
    if (a.driver.userId === actor.userId) throw forbidden("You cannot decide your own salary adjustment.");
    await tx.salaryAdjustment.update({ where: { id }, data: { status: decision, approvedById: actor.userId, approvedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: decision === "APPROVED" ? "salary_adjustment.approved" : "salary_adjustment.voided", entityType: "SalaryAdjustment", entityId: id, reason });
  });
}

export async function listPayroll(db: Db, actor: AdminActor, q: { driverId?: string; status?: "DRAFT" | "APPROVED" | "PAID" }) {
  assertCan(actor, "PAYROLL");
  const [runs, adjustments] = await Promise.all([
    db.payrollRun.findMany({ where: { ...(q.driverId ? { driverId: q.driverId } : {}), ...(q.status ? { status: q.status } : {}) }, include: { driver: true }, orderBy: { periodStart: "desc" }, take: 200 }),
    db.salaryAdjustment.findMany({ where: { ...(q.driverId ? { driverId: q.driverId } : {}), payrollRunId: null, status: { in: ["PENDING", "APPROVED"] } }, include: { driver: true }, orderBy: { effectiveOn: "desc" } }),
  ]);
  return {
    runs: runs.map((r) => ({
      id: r.id,
      driver: { id: r.driver.id, driverCode: r.driver.driverCode, fullName: r.driver.fullName },
      periodStart: dateOnlyString(r.periodStart),
      periodEnd: dateOnlyString(r.periodEnd),
      method: r.method,
      status: r.status,
      approvedHours: r.approvedHours.toFixed(1),
      workingDays: r.workingDays,
      grossAmount: r.grossAmount.toFixed(2),
      additionsTotal: r.additionsTotal.toFixed(2),
      deductionsTotal: r.deductionsTotal.toFixed(2),
      netAmount: r.netAmount.toFixed(2),
      paidAt: r.paidAt ? dateOnlyString(r.paidAt) : null,
      paymentMode: r.paymentMode,
      paymentRef: r.paymentRef,
    })),
    openAdjustments: adjustments.map((a) => ({
      id: a.id,
      driver: { id: a.driver.id, fullName: a.driver.fullName },
      kind: a.kind,
      amount: a.amount.toFixed(2),
      description: a.description,
      effectiveOn: dateOnlyString(a.effectiveOn),
      status: a.status,
    })),
  };
}
