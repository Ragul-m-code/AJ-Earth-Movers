// Reports and dashboard. Every figure states what it is: approved work ≠ invoiced revenue ≠ collected cash.
import { photoStorageUsage } from "./storageUsage.js";
import type { Db } from "../db.js";
import { displayStatus } from "../domain/billing.js";
import { workingDays } from "../domain/pay.js";
import { dateOnly, dateOnlyString, istDateString } from "../domain/time.js";
import { paiseToString, tenthsToString } from "../domain/units.js";
import { toPaise, toTenths } from "../lib/dec.js";
import { type AdminActor, assertCan } from "./actor.js";
import { OPEN_STATUSES } from "./assignments.js";

interface Range {
  from: string;
  to: string;
}
const dayCount = (r: Range) => Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) + 1;
const inRange = (r: Range) => ({ gte: dateOnly(r.from), lte: dateOnly(r.to) });

export async function operatingHoursReport(db: Db, actor: AdminActor, r: Range, groupBy: "vehicle" | "driver" | "customer") {
  assertCan(actor, "REPORTS");
  const work = await db.approvedWork.findMany({ where: { workDate: inRange(r) }, include: { vehicle: true, driver: true, customer: true } });
  const groups = new Map<string, { key: string; label: string; hours: number; breakerHours: number; jobs: number; dates: string[] }>();
  for (const w of work) {
    const [key, label] =
      groupBy === "vehicle" ? [w.vehicleId, `${w.vehicle.unitCode} · ${w.vehicle.make} ${w.vehicle.model}`] : groupBy === "driver" ? [w.driverId, `${w.driver.fullName} (${w.driver.driverCode})`] : [w.customerId, w.customer.name];
    const g = groups.get(key) ?? { key, label, hours: 0, breakerHours: 0, jobs: 0, dates: [] };
    g.hours += toTenths(w.approvedHours);
    g.breakerHours += toTenths(w.breakerHours);
    g.jobs += 1;
    g.dates.push(dateOnlyString(w.workDate));
    groups.set(key, g);
  }
  const rows = [...groups.values()]
    .sort((a, b) => b.hours - a.hours)
    .map((g) => ({ key: g.key, label: g.label, approvedHours: tenthsToString(g.hours), breakerHours: tenthsToString(g.breakerHours), jobs: g.jobs, workingDays: workingDays(g.dates) }));
  return { range: r, groupBy, rows, totalHours: tenthsToString(work.reduce((s, w) => s + toTenths(w.approvedHours), 0)), note: "Approved operating hours only. Pending and rejected submissions are excluded." };
}

export async function utilizationReport(db: Db, actor: AdminActor, r: Range) {
  assertCan(actor, "REPORTS");
  const [vehicles, work, maintenance] = await Promise.all([
    db.vehicle.findMany({ where: { status: { not: "INACTIVE" } }, orderBy: { unitCode: "asc" } }),
    db.approvedWork.findMany({ where: { workDate: inRange(r) }, select: { vehicleId: true, workDate: true, approvedHours: true } }),
    db.maintenanceRecord.findMany({ where: { startedAt: { not: null, lte: new Date(`${r.to}T23:59:59+05:30`) }, OR: [{ completedAt: null }, { completedAt: { gte: new Date(`${r.from}T00:00:00+05:30`) } }] } }),
  ]);
  const days = dayCount(r);
  const rows = vehicles.map((v) => {
    const mine = work.filter((w) => w.vehicleId === v.id);
    const activeDays = workingDays(mine.map((w) => dateOnlyString(w.workDate)));
    // Days the machine was in the workshop during the range (any part of a day counts).
    const down = new Set<string>();
    for (const m of maintenance.filter((x) => x.vehicleId === v.id)) {
      let t = Math.max(m.startedAt!.getTime(), Date.parse(`${r.from}T00:00:00+05:30`));
      const end = Math.min((m.completedAt ?? new Date()).getTime(), Date.parse(`${r.to}T23:59:59+05:30`));
      for (; t <= end; t += 86_400_000) down.add(istDateString(new Date(t)));
    }
    const available = Math.max(0, days - down.size);
    return {
      vehicleId: v.id,
      unitCode: v.unitCode,
      model: `${v.make} ${v.model}`,
      approvedHours: tenthsToString(mine.reduce((s, w) => s + toTenths(w.approvedHours), 0)),
      activeDays,
      maintenanceDays: down.size,
      availableDays: available,
      utilizationPct: available > 0 ? Math.round((activeDays / available) * 1000) / 10 : null,
    };
  });
  return { range: r, days, rows, note: "Utilization = days with approved work ÷ days not in maintenance. It does not measure hours against a capacity target." };
}

export async function billingReport(db: Db, actor: AdminActor, r: Range) {
  assertCan(actor, "REPORTS", "INVOICES");
  const [customers, invoices, payments, unbilled, open] = await Promise.all([
    db.customer.findMany({ orderBy: { name: "asc" } }),
    db.invoice.findMany({ where: { issueDate: inRange(r), status: { not: "CANCELLED" } } }),
    db.payment.findMany({ where: { receivedOn: inRange(r) } }),
    db.approvedWork.groupBy({ by: ["customerId"], where: { invoiceId: null }, _sum: { approvedHours: true }, _count: true }),
    db.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } } }),
  ]);
  const rows = customers
    .map((c) => {
      const inv = invoices.filter((i) => i.customerId === c.id);
      const pay = payments.filter((p) => p.customerId === c.id);
      const outstanding = open.filter((i) => i.customerId === c.id).reduce((s, i) => s + toPaise(i.total) - toPaise(i.amountPaid), 0);
      const ub = unbilled.find((u) => u.customerId === c.id);
      return {
        customerId: c.id,
        name: c.name,
        invoicedTaxable: paiseToString(inv.reduce((s, i) => s + toPaise(i.taxableValue), 0)),
        invoicedTotal: paiseToString(inv.reduce((s, i) => s + toPaise(i.total), 0)),
        collected: paiseToString(pay.reduce((s, p) => s + toPaise(p.amount), 0)),
        outstanding: paiseToString(outstanding),
        unbilledJobs: ub?._count ?? 0,
        unbilledHours: ub?._sum.approvedHours?.toFixed(1) ?? "0.0",
      };
    })
    .filter((x) => x.invoicedTotal !== "0.00" || x.collected !== "0.00" || x.outstanding !== "0.00" || x.unbilledJobs > 0);
  return { range: r, rows, note: "Invoiced = issued invoices in the period. Collected = payments received in the period. Outstanding and unbilled are as of today." };
}

export async function outstandingReport(db: Db, actor: AdminActor) {
  assertCan(actor, "REPORTS", "INVOICES");
  const today = istDateString(new Date());
  const open = await db.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, include: { customer: true }, orderBy: { dueDate: "asc" } });
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  const rows = open.map((i) => {
    const balance = toPaise(i.total) - toPaise(i.amountPaid);
    const due = i.dueDate ? dateOnlyString(i.dueDate) : today;
    const late = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000));
    const bucket = late === 0 ? "current" : late <= 30 ? "d1_30" : late <= 60 ? "d31_60" : late <= 90 ? "d61_90" : "d90plus";
    buckets[bucket] += balance;
    return { invoiceId: i.id, number: i.number, customer: i.customer.name, dueDate: due, daysOverdue: late, total: i.total.toFixed(2), balance: paiseToString(balance), status: displayStatus(i.status, due, today) };
  });
  return { asOf: today, rows, buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, paiseToString(v)])), total: paiseToString(Object.values(buckets).reduce((s, v) => s + v, 0)) };
}

export async function driverEarningsReport(db: Db, actor: AdminActor, r: Range) {
  assertCan(actor, "REPORTS", "PAYROLL");
  const [drivers, work, runs] = await Promise.all([
    db.driver.findMany({ orderBy: { fullName: "asc" } }),
    db.approvedWork.findMany({ where: { workDate: inRange(r) } }),
    db.payrollRun.findMany({ where: { status: "PAID", paidAt: inRange(r) } }),
  ]);
  const rows = drivers
    .map((d) => {
      const mine = work.filter((w) => w.driverId === d.id);
      return {
        driverId: d.id,
        name: `${d.fullName} (${d.driverCode})`,
        approvedHours: tenthsToString(mine.reduce((s, w) => s + toTenths(w.approvedHours), 0)),
        workingDays: workingDays(mine.map((w) => dateOnlyString(w.workDate))),
        hourlyEarnings: paiseToString(mine.reduce((s, w) => s + toPaise(w.driverAmount), 0)),
        salaryPaid: paiseToString(runs.filter((p) => p.driverId === d.id).reduce((s, p) => s + toPaise(p.netAmount), 0)),
      };
    })
    .filter((x) => x.approvedHours !== "0.0" || x.salaryPaid !== "0.00");
  return { range: r, rows, note: "Hourly earnings = approved hours × each driver's own rate (fixed-salary drivers show 0). Salary paid = payroll runs paid in the period." };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Prefix formula-like cells so spreadsheets do not execute them. Only plain numbers ("-12.50") are exempt:
    // "-1+HYPERLINK(...)" starts with a digit too but is still a formula.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export async function dashboard(db: Db, actor: AdminActor) {
  assertCan(actor, "DASHBOARD");
  const today = istDateString(new Date());
  const todayDate = dateOnly(today);
  const monthStart = dateOnly(`${today.slice(0, 7)}-01`);
  const [vehicles, inProgress, pending, corrections, todayJobs, open, unbilled, monthWork, attention, maintenanceDue] = await Promise.all([
    db.vehicle.findMany({ include: { workOrders: { where: { status: { in: OPEN_STATUSES }, workDate: { gte: todayDate } } } } }),
    db.workOrder.count({ where: { status: "IN_PROGRESS" } }),
    db.workOrder.count({ where: { status: "PENDING_APPROVAL" } }),
    db.workOrder.count({ where: { status: "CORRECTION_REQUIRED" } }),
    db.workOrder.findMany({ where: { workDate: todayDate, status: { notIn: ["CANCELLED"] } }, include: { vehicle: true, driver: true, customer: true }, orderBy: { code: "asc" } }),
    actor.permissions.has("INVOICES") ? db.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, include: { customer: true } }) : Promise.resolve([]),
    db.approvedWork.aggregate({ where: { invoiceId: null }, _sum: { approvedHours: true }, _count: true }),
    db.approvedWork.aggregate({ where: { workDate: { gte: monthStart } }, _sum: { approvedHours: true }, _count: true }),
    db.workOrder.findMany({ where: { status: "PENDING_APPROVAL" }, include: { vehicle: true, driver: true, readings: true }, orderBy: { submittedAt: "asc" }, take: 5 }),
    db.maintenanceRecord.count({ where: { status: "SCHEDULED", scheduledOn: { lte: dateOnly(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)) } } }),
  ]);
  const overdue = open.filter((i) => displayStatus(i.status, i.dueDate ? dateOnlyString(i.dueDate) : null, today) === "OVERDUE");
  const active = vehicles.filter((v) => v.status !== "INACTIVE");
  // Storage warnings go to people who can act on them (raise the quota/plan).
  const storage = actor.permissions.has("SETTINGS") ? await photoStorageUsage(db) : null;
  return {
    today,
    storage: storage && storage.level !== "ok" ? storage : null,
    fleet: {
      total: active.length,
      working: vehicles.filter((v) => v.status === "AVAILABLE" && v.workOrders.some((w) => w.status === "IN_PROGRESS")).length,
      maintenance: vehicles.filter((v) => v.status === "MAINTENANCE").length,
      available: vehicles.filter((v) => v.status === "AVAILABLE" && v.workOrders.length === 0).length,
    },
    jobs: { inProgress, pendingApproval: pending, correctionRequired: corrections, today: todayJobs.length },
    month: { approvedHours: monthWork._sum.approvedHours?.toFixed(1) ?? "0.0", approvedJobs: monthWork._count },
    unbilled: { jobs: unbilled._count, hours: unbilled._sum.approvedHours?.toFixed(1) ?? "0.0" },
    receivables: actor.permissions.has("INVOICES")
      ? {
          outstanding: paiseToString(open.reduce((s, i) => s + toPaise(i.total) - toPaise(i.amountPaid), 0)),
          overdueAmount: paiseToString(overdue.reduce((s, i) => s + toPaise(i.total) - toPaise(i.amountPaid), 0)),
          overdueCount: overdue.length,
          topOverdue: overdue
            .sort((a, b) => toPaise(b.total) - toPaise(b.amountPaid) - (toPaise(a.total) - toPaise(a.amountPaid)))
            .slice(0, 3)
            .map((i) => ({ invoiceId: i.id, number: i.number, customer: i.customer.name, balance: paiseToString(toPaise(i.total) - toPaise(i.amountPaid)), dueDate: i.dueDate ? dateOnlyString(i.dueDate) : null })),
        }
      : null,
    maintenanceDueSoon: maintenanceDue,
    pendingReviews: attention.map((w) => {
      const start = w.readings.filter((x) => x.kind === "START").sort((a, b) => b.revision - a.revision)[0];
      const end = w.readings.filter((x) => x.kind === "END").sort((a, b) => b.revision - a.revision)[0];
      return { workOrderId: w.id, code: w.code, vehicle: `${w.vehicle.make} ${w.vehicle.model}`, driverName: w.driver.fullName, hours: start && end ? tenthsToString(toTenths(end.value) - toTenths(start.value)) : null, submittedAt: w.submittedAt?.toISOString() ?? null };
    }),
    todayJobs: todayJobs.map((w) => ({ workOrderId: w.id, code: w.code, status: w.status, vehicle: `${w.vehicle.make} ${w.vehicle.model}`, unitCode: w.vehicle.unitCode, driverName: w.driver.fullName, customerName: w.customer.name, siteName: w.siteName })),
  };
}
