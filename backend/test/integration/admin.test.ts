// Admin-side business rules. Numbers in test names refer to the required cases in the project brief (§11).
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db.js";
import { dateOnly } from "../../src/domain/time.js";
import { createInvoiceDraft, getInvoice, issueInvoice } from "../../src/services/invoices.js";
import { createPayrollRun } from "../../src/services/payroll.js";
import { recordPayment } from "../../src/services/payments.js";
import { reviewSubmission } from "../../src/services/review.js";
import { adminLogin, fixtures, loginAs, resetDb, setupTestApp, submittedViaApi } from "./helpers.js";

let app: FastifyInstance;
let db: Db;
let f: Awaited<ReturnType<typeof fixtures>>;
let driverAuth: { authorization: string };

beforeAll(async () => {
  ({ app, db } = await setupTestApp());
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb(db);
  f = await fixtures(db);
  driverAuth = await loginAs(app, "DRV-1", "123456");
});

/** Approved job for driver 1 on a date, `hours` long, optionally with breaker hours. */
async function approvedJob(date: string, start: string, end: string, opts: { breaker?: boolean; breakerHours?: string; vehicleId?: string; customerId?: string } = {}) {
  const wo = await f.newWorkOrder(f.d1.driver.id, date, { attachmentIds: opts.breaker ? [f.breaker.id] : undefined, vehicleId: opts.vehicleId, customerId: opts.customerId });
  await submittedViaApi(app, db, driverAuth, wo.id, start, end);
  await reviewSubmission(db, f.actors.manager, wo.id, { decision: "APPROVED", breakerHours: opts.breakerHours });
  return db.approvedWork.findUniqueOrThrow({ where: { workOrderId: wo.id } });
}

const verifyTax = async () => {
  await db.businessProfile.create({ data: { id: "default", legalName: "AJ Test Co", gstin: "27AAAAA0000A1Z5", stateCode: "27", address: "Pune", verificationStatus: "VERIFIED" } });
  return db.taxRule.create({
    data: { name: "Test rule", cgstRate: new Prisma.Decimal("9.00"), sgstRate: new Prisma.Decimal("9.00"), verificationStatus: "VERIFIED", createdById: f.owner.id },
  });
};

describe("meter approval (cases 2–6)", () => {
  it("2: a driver cannot approve a meter submission", async () => {
    const wo = await f.newWorkOrder(f.d1.driver.id);
    await submittedViaApi(app, db, driverAuth, wo.id, "1000", "1008");
    const r = await app.inject({ method: "POST", url: `/api/admin/work-orders/${wo.id}/review`, headers: driverAuth, payload: { decision: "APPROVED" } });
    expect(r.statusCode).toBe(403);
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status).toBe("PENDING_APPROVAL");
  });

  it("3–4: an administrator can approve or reject; the rejection reason is kept", async () => {
    const auth = await adminLogin(app, "manager@test.local");
    const a = await f.newWorkOrder(f.d1.driver.id, "2026-10-16");
    await submittedViaApi(app, db, driverAuth, a.id, "1000", "1008");
    const approved = await app.inject({ method: "POST", url: `/api/admin/work-orders/${a.id}/review`, headers: auth, payload: { decision: "APPROVED" } });
    expect(approved.json()).toMatchObject({ status: "APPROVED", ledger: { approvedHours: "8.0" } });

    const b = await f.newWorkOrder(f.d1.driver.id, "2026-10-17");
    await submittedViaApi(app, db, driverAuth, b.id, "1008", "1016");
    const reason = "The ending digits are blurred, please retake";
    const rejected = await app.inject({ method: "POST", url: `/api/admin/work-orders/${b.id}/review`, headers: auth, payload: { decision: "REJECTED", correctionTarget: "END", reason } });
    expect(rejected.json()).toMatchObject({ status: "CORRECTION_REQUIRED", latestReview: { reason } });
    const driverView = await app.inject({ method: "GET", url: `/api/driver/work-orders/${b.id}`, headers: driverAuth });
    expect(driverView.json().latestReview.reason).toBe(reason);
  });

  it("5: negative hours are refused unless an authorized rollover correction is recorded", async () => {
    const wo = await f.newWorkOrder(f.d1.driver.id);
    await submittedViaApi(app, db, driverAuth, wo.id, "9998", "6"); // meter rolled over 9999.9 → 0
    await expect(reviewSubmission(db, f.actors.manager, wo.id, { decision: "APPROVED" })).rejects.toMatchObject({ code: "NEGATIVE_HOURS" });
    // A manager without METER_CORRECTION cannot record a correction…
    const correction = { kind: "ROLLOVER" as const, approvedHours: "8.0", reason: "Meter rolled over from 9999.9 to 0000.0" };
    await expect(reviewSubmission(db, f.actors.manager, wo.id, { decision: "APPROVED", adjustment: correction })).rejects.toMatchObject({ status: 403 });
    // …the owner can, with a reason, and both readings are preserved.
    await reviewSubmission(db, f.actors.owner, wo.id, { decision: "APPROVED", adjustment: correction });
    const w = await db.approvedWork.findUniqueOrThrow({ where: { workOrderId: wo.id } });
    expect([w.startMeter.toFixed(1), w.endMeter.toFixed(1), w.approvedHours.toFixed(1)]).toEqual(["9998.0", "6.0", "8.0"]);
    const review = await db.meterReview.findFirstOrThrow({ where: { workOrderId: wo.id } });
    expect(review).toMatchObject({ adjustmentKind: "ROLLOVER" });
    expect(review.computedHours.toFixed(1)).toBe("-9992.0");
  });

  it("6: pending and rejected hours are excluded from billing and payroll", async () => {
    await approvedJob("2026-10-16", "1000", "1008");
    const pending = await f.newWorkOrder(f.d1.driver.id, "2026-10-17");
    await submittedViaApi(app, db, driverAuth, pending.id, "1008", "1012");
    const rejected = await f.newWorkOrder(f.d1.driver.id, "2026-10-18");
    await submittedViaApi(app, db, driverAuth, rejected.id, "1012", "1015");
    await reviewSubmission(db, f.actors.manager, rejected.id, { decision: "REJECTED", correctionTarget: "END", reason: "Photo unreadable" });

    const billable = await app.inject({ method: "GET", url: `/api/admin/invoices/billable?customerId=${f.customer.id}&from=2026-10-01&to=2026-10-31`, headers: await adminLogin(app, "accounts@test.local") });
    expect(billable.json().items).toHaveLength(1);
    expect(billable.json().notYetApproved.map((w: { status: string }) => w.status).sort()).toEqual(["CORRECTION_REQUIRED", "PENDING_APPROVAL"]);

    const preview = await app.inject({ method: "GET", url: `/api/admin/payroll/preview?driverId=${f.d1.driver.id}&from=2026-10-01&to=2026-10-31`, headers: await adminLogin(app, "accounts@test.local") });
    expect(preview.json()).toMatchObject({ approvedHours: "8.0", gross: "1200.00" }); // 8 h × ₹150 (rate from 15 Oct)
    expect(preview.json().warnings[0]).toMatch(/2 job/);
  });
});

describe("customer billing (cases 7, 8, 11, 14, 15, 16)", () => {
  it("7–8: charges approved hours at the customer rate and adds breaker only when used", async () => {
    const plain = await approvedJob("2026-10-16", "1000", "1008.5"); // 8.5 h, no breaker
    const withBreaker = await approvedJob("2026-10-17", "1008.5", "1016.5", { breaker: true, breakerHours: "5.5" });
    const assignedButUnused = await approvedJob("2026-10-18", "1016.5", "1020.5", { breaker: true, breakerHours: "0" });
    const inv = await createInvoiceDraft(db, f.actors.accounts, {
      customerId: f.customer.id, kind: "PROFORMA", periodStart: "2026-10-01", periodEnd: "2026-10-31",
      approvedWorkIds: [plain.id, withBreaker.id, assignedButUnused.id], idempotencyKey: randomUUID(),
    });
    const lines = inv.lines.map((l) => [l.kind, l.quantity, l.unitRate, l.amount, l.rateSource]);
    expect(lines).toEqual([
      ["MACHINE", "8.5", "1850.00", "15725.00", "customer:category"],
      ["MACHINE", "8.0", "1850.00", "14800.00", "customer:category"],
      ["BREAKER", "5.5", "400.00", "2200.00", "attachment-default"],
      ["MACHINE", "4.0", "1850.00", "7400.00", "customer:category"],
    ]);
    expect(inv.totals).toMatchObject({ subtotal: "40125.00", taxTotal: "0.00", total: "40125.00", hours: "20.5" });
  });

  it("9: driver pay uses the driver's own rate, not the customer's", async () => {
    const w = await approvedJob("2026-10-16", "1000", "1008.5");
    expect([w.driverRate?.toFixed(2), w.driverAmount.toFixed(2)]).toEqual(["150.00", "1275.00"]); // not ₹1,850
  });

  it("11: a work record cannot be billed twice, even by concurrent requests", async () => {
    const w = await approvedJob("2026-10-16", "1000", "1008");
    const draft = (key: string) =>
      createInvoiceDraft(db, f.actors.accounts, { customerId: f.customer.id, kind: "PROFORMA", periodStart: "2026-10-01", periodEnd: "2026-10-31", approvedWorkIds: [w.id], idempotencyKey: key });
    const results = await Promise.allSettled([draft(randomUUID()), draft(randomUUID())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "ALREADY_BILLED" } });
    expect(await db.invoiceLine.count({ where: { approvedWorkId: w.id } })).toBe(1);
    // The same idempotency key returns the same draft instead of failing.
    const key = randomUUID();
    const w2 = await approvedJob("2026-10-17", "1008", "1010");
    const first = await createInvoiceDraft(db, f.actors.accounts, { customerId: f.customer.id, kind: "PROFORMA", periodStart: "2026-10-01", periodEnd: "2026-10-31", approvedWorkIds: [w2.id], idempotencyKey: key });
    const again = await createInvoiceDraft(db, f.actors.accounts, { customerId: f.customer.id, kind: "PROFORMA", periodStart: "2026-10-01", periodEnd: "2026-10-31", approvedWorkIds: [w2.id], idempotencyKey: key });
    expect(again.id).toBe(first.id);
  });

  it("14: tax-unverified invoices cannot be issued as tax invoices", async () => {
    const w = await approvedJob("2026-10-16", "1000", "1010");
    const auth = await adminLogin(app, "accounts@test.local");
    const create = await app.inject({
      method: "POST", url: "/api/admin/invoices", headers: auth,
      payload: { customerId: f.customer.id, kind: "TAX_INVOICE", periodStart: "2026-10-01", periodEnd: "2026-10-31", approvedWorkIds: [w.id], idempotencyKey: randomUUID() },
    });
    const invId = create.json().id;
    const unverifiedRule = await db.taxRule.create({ data: { name: "Unverified", cgstRate: new Prisma.Decimal("9"), sgstRate: new Prisma.Decimal("9"), createdById: f.owner.id } });
    await app.inject({ method: "POST", url: `/api/admin/invoices/${invId}/tax`, headers: auth, payload: { taxRuleId: unverifiedRule.id, split: "INTRA_STATE" } });
    const blocked = await app.inject({ method: "POST", url: `/api/admin/invoices/${invId}/issue`, headers: auth, payload: {} });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("CANNOT_ISSUE");
    expect(blocked.json().error.details.blockers.join(" ")).toMatch(/Business profile.*not been verified.*Tax rule "Unverified" has not been verified/);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invId } })).number).toBeNull();

    const rule = await verifyTax();
    await app.inject({ method: "POST", url: `/api/admin/invoices/${invId}/tax`, headers: auth, payload: { taxRuleId: rule.id, split: "INTRA_STATE" } });
    const issued = await app.inject({ method: "POST", url: `/api/admin/invoices/${invId}/issue`, headers: auth, payload: { issueDate: "2026-10-31" } });
    expect(issued.json()).toMatchObject({ number: "AJ/2026-27/0001", status: "ISSUED", totals: { taxableValue: "18500.00", cgst: "1665.00", sgst: "1665.00", total: "21830.00" } });
  });

  it("15: issued invoices and paid payroll do not change when rates change later", async () => {
    const w = await approvedJob("2026-10-16", "1000", "1010");
    const rule = await verifyTax();
    const inv = await createInvoiceDraft(db, f.actors.accounts, { customerId: f.customer.id, kind: "TAX_INVOICE", periodStart: "2026-10-01", periodEnd: "2026-10-31", approvedWorkIds: [w.id], idempotencyKey: randomUUID() });
    await db.invoice.update({ where: { id: inv.id }, data: { taxRuleId: rule.id, taxSplit: "INTRA_STATE", cgstRate: rule.cgstRate, sgstRate: rule.sgstRate } });
    await issueInvoice(db, f.actors.accounts, inv.id, { issueDate: "2026-10-31" });
    const before = await getInvoice(db, f.actors.accounts, inv.id);
    const run = await createPayrollRun(db, f.actors.accounts, f.d1.driver.id, { start: "2026-10-01", end: "2026-10-31" });

    // New rates take effect from 1 Oct, i.e. back-dated over the billed work.
    await db.customerRate.create({ data: { customerId: f.customer.id, category: "Backhoe", hourlyRate: new Prisma.Decimal("2500.00"), effectiveFrom: dateOnly("2026-10-01") } });
    await db.taxRule.update({ where: { id: rule.id }, data: { cgstRate: new Prisma.Decimal("14") } });
    const after = await getInvoice(db, f.actors.accounts, inv.id);
    expect(after.lines).toEqual(before.lines);
    expect(after.totals).toEqual(before.totals);
    // Driver pay terms cannot be back-dated over payroll that already exists.
    const comp = await app.inject({
      method: "POST", url: `/api/admin/drivers/${f.d1.driver.id}/compensation`, headers: await adminLogin(app, "owner@test.local"),
      payload: { method: "HOURLY", hourlyRate: "999", effectiveFrom: "2026-10-01", note: "Back-dated raise" },
    });
    expect(comp.json().error.code).toBe("PAYROLL_EXISTS");
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).netAmount.toFixed(2)).toBe("1500.00");
  });

  it("16: a failure part-way through leaves no partial invoice or payment", async () => {
    const ok = await approvedJob("2026-10-16", "1000", "1008");
    // Customer B has no rate for vehicle 2's category and vehicle 2 has its default; remove that default to force a missing rate.
    const noRate = await approvedJob("2026-10-17", "500", "508", { vehicleId: f.vehicle2.id });
    await db.vehicleRate.deleteMany({ where: { vehicleId: f.vehicle2.id } });
    await expect(
      createInvoiceDraft(db, f.actors.accounts, { customerId: f.customer.id, kind: "PROFORMA", periodStart: "2026-10-01", periodEnd: "2026-10-31", approvedWorkIds: [ok.id, noRate.id], idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "RATE_MISSING" });
    expect(await db.invoice.count()).toBe(0);
    expect(await db.approvedWork.count({ where: { invoiceId: { not: null } } })).toBe(0); // claims rolled back

    const inv = await createInvoiceDraft(db, f.actors.accounts, { customerId: f.customer.id, kind: "PROFORMA", periodStart: "2026-10-01", periodEnd: "2026-10-31", approvedWorkIds: [ok.id], idempotencyKey: randomUUID() });
    await issueInvoice(db, f.actors.accounts, inv.id, {});
    // Allocation larger than the balance aborts the whole payment.
    await expect(
      recordPayment(db, f.actors.accounts, { customerId: f.customer.id, receivedOn: "2026-10-20", amount: "99999", mode: "NEFT", idempotencyKey: randomUUID(), allocations: [{ invoiceId: inv.id, amount: "99999" }] }),
    ).rejects.toMatchObject({ code: "OVERPAYMENT" });
    expect(await db.payment.count()).toBe(0);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid.toFixed(2)).toBe("0.00");
  });
});

describe("payments and payroll (cases 10, 12)", () => {
  it("12: a repeated payment request records the payment once", async () => {
    const w = await approvedJob("2026-10-16", "1000", "1008");
    const inv = await createInvoiceDraft(db, f.actors.accounts, { customerId: f.customer.id, kind: "PROFORMA", periodStart: "2026-10-01", periodEnd: "2026-10-31", approvedWorkIds: [w.id], idempotencyKey: randomUUID() });
    await issueInvoice(db, f.actors.accounts, inv.id, {});
    const auth = await adminLogin(app, "accounts@test.local");
    const payload = { customerId: f.customer.id, receivedOn: "2026-10-20", amount: "10000", mode: "NEFT", reference: "UTR123", idempotencyKey: randomUUID(), allocations: [{ invoiceId: inv.id, amount: "10000" }] };
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/api/admin/payments", headers: auth, payload }),
      app.inject({ method: "POST", url: "/api/admin/payments", headers: auth, payload }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(await db.payment.count()).toBe(1);
    const invAfter = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect([invAfter.amountPaid.toFixed(2), invAfter.status]).toEqual(["10000.00", "PARTIALLY_PAID"]); // 8 h × ₹1,850 = ₹14,800
  });

  it("10: fixed salary is independent of hours worked", async () => {
    const drv3 = await loginAs(app, "DRV-3", "111222");
    const wo = await f.newWorkOrder(f.fixedDriver.driver.id, "2026-09-10");
    await submittedViaApi(app, db, drv3, wo.id, "100", "110");
    await reviewSubmission(db, f.actors.manager, wo.id, { decision: "APPROVED" });
    const w = await db.approvedWork.findUniqueOrThrow({ where: { workOrderId: wo.id } });
    expect([w.compensationMethod, w.driverRate, w.driverAmount.toFixed(2)]).toEqual(["FIXED", null, "0.00"]);

    await db.salaryAdjustment.create({ data: { driverId: f.fixedDriver.driver.id, kind: "ADDITION", amount: new Prisma.Decimal("1000"), description: "Festival bonus", effectiveOn: dateOnly("2026-09-15"), status: "APPROVED", createdById: f.owner.id } });
    await expect(createPayrollRun(db, f.actors.accounts, f.fixedDriver.driver.id, { start: "2026-09-01", end: "2026-09-15" })).rejects.toMatchObject({ code: "FIXED_NEEDS_MONTH" });
    const run = await createPayrollRun(db, f.actors.accounts, f.fixedDriver.driver.id, { start: "2026-09-01", end: "2026-09-30" });
    expect([run.approvedHours.toFixed(1), run.grossAmount.toFixed(2), run.additionsTotal.toFixed(2), run.netAmount.toFixed(2)]).toEqual(["10.0", "24000.00", "1000.00", "25000.00"]);
    // Same work cannot be paid by a second run.
    await expect(createPayrollRun(db, f.actors.accounts, f.fixedDriver.driver.id, { start: "2026-09-01", end: "2026-09-30" })).rejects.toMatchObject({ code: "PERIOD_OVERLAP" });
  });

  it("marks payroll paid once and blocks self-approval of adjustments", async () => {
    await approvedJob("2026-10-16", "1000", "1010");
    const run = await createPayrollRun(db, f.actors.accounts, f.d1.driver.id, { start: "2026-10-01", end: "2026-10-31" });
    const auth = await adminLogin(app, "accounts@test.local");
    expect((await app.inject({ method: "POST", url: `/api/admin/payroll/${run.id}/paid`, headers: auth, payload: { paidOn: "2026-11-01", mode: "NEFT" } })).json().error.code).toBe("NOT_APPROVED");
    await app.inject({ method: "POST", url: `/api/admin/payroll/${run.id}/approve`, headers: auth });
    for (let i = 0; i < 2; i++) {
      expect((await app.inject({ method: "POST", url: `/api/admin/payroll/${run.id}/paid`, headers: auth, payload: { paidOn: "2026-11-01", mode: "NEFT", reference: "SAL1" } })).statusCode).toBe(204);
    }
    expect(await db.auditLog.count({ where: { action: "payroll.paid", entityId: run.id } })).toBe(1);

    const adj = await app.inject({ method: "POST", url: `/api/admin/drivers/${f.d1.driver.id}/adjustments`, headers: auth, payload: { kind: "ADDITION", amount: "500", description: "Night allowance", effectiveOn: "2026-11-02" } });
    const self = await app.inject({ method: "POST", url: `/api/admin/adjustments/${adj.json().id}/decision`, headers: auth, payload: { decision: "APPROVED" } });
    expect(self.statusCode).toBe(403);
  });
});

describe("access control (case 13) and fleet rules", () => {
  it("13: unauthorized users cannot view protected financial records", async () => {
    const manager = await adminLogin(app, "manager@test.local");
    expect((await app.inject({ method: "GET", url: "/api/admin/invoices", headers: manager })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/admin/payroll", headers: manager })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/admin/users", headers: manager })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/admin/invoices", headers: driverAuth })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/admin/invoices" })).statusCode).toBe(401);
    // Drivers' pay is hidden from users without payroll permission.
    const drivers = await app.inject({ method: "GET", url: "/api/admin/drivers", headers: manager });
    expect(drivers.json().every((d: { compensation: unknown }) => d.compensation === null)).toBe(true);
    const accounts = await adminLogin(app, "accounts@test.local");
    expect((await app.inject({ method: "GET", url: "/api/admin/invoices", headers: accounts })).statusCode).toBe(200);
  });

  it("forces a password change for temporary passwords", async () => {
    const owner = await adminLogin(app, "owner@test.local");
    const created = await app.inject({ method: "POST", url: "/api/admin/users", headers: owner, payload: { displayName: "New Clerk", email: "clerk@test.local", role: "ACCOUNTS" } });
    const temp = created.json().temporaryPassword as string;
    const clerk = await adminLogin(app, "clerk@test.local", temp);
    expect((await app.inject({ method: "GET", url: "/api/admin/dashboard", headers: clerk })).json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    const weak = await app.inject({ method: "POST", url: "/api/auth/admin/change-password", headers: clerk, payload: { currentPassword: temp, newPassword: "short" } });
    expect(weak.statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/auth/admin/change-password", headers: clerk, payload: { currentPassword: temp, newPassword: "ClerkPass2026" } })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/admin/dashboard", headers: clerk })).statusCode).toBe(200);
  });

  it("prevents conflicting open assignments for the same machine", async () => {
    await f.newWorkOrder(f.d1.driver.id, "2026-10-20");
    await expect(f.newWorkOrder(f.d2.driver.id, "2026-10-20")).rejects.toMatchObject({ code: "VEHICLE_BOOKED" });
    const results = await Promise.allSettled([f.newWorkOrder(f.d1.driver.id, "2026-10-21"), f.newWorkOrder(f.d2.driver.id, "2026-10-21")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(f.newWorkOrder(f.d2.driver.id, "2026-10-22")).resolves.toBeDefined();
  });

  it("exports reports as CSV", async () => {
    await approvedJob("2026-10-16", "1000", "1008");
    const r = await app.inject({ method: "GET", url: "/api/admin/reports/operating-hours?from=2026-10-01&to=2026-10-31&groupBy=driver&format=csv", headers: await adminLogin(app, "owner@test.local") });
    expect(r.headers["content-type"]).toMatch(/text\/csv/);
    expect(r.body).toContain("approvedHours");
    expect(r.body).toContain("8.0");
  });
});
