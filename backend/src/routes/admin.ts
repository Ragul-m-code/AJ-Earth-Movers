import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../buildApp.js";
import { istDateString, monthRange } from "../domain/time.js";
import { requireAdmin } from "../lib/auth.js";
import { ALL_MODULES } from "../lib/permissions.js";
import { actorFromAuth, assertCan } from "../services/actor.js";
import { photoStorageUsage } from "../services/storageUsage.js";
import { cancelWorkOrder, createWorkOrder, getWorkOrderAdmin, listWorkOrdersAdmin, reassignWorkOrder, OPEN_STATUSES } from "../services/assignments.js";
import { addCustomerAttachmentRate, addCustomerRate, getCustomer, listCustomers, saveCustomer, saveSite } from "../services/customers.js";
import { addCompensation, createDriver, driverWorkHistory, getDriver, listDrivers, resetDriverPin, setDriverStatus, updateDriver } from "../services/drivers.js";
import { addAttachmentRate, addVehicleRate, createVehicle, getAttachment, getVehicle, listAttachments, listVehicles, setVehicleStatus, updateVehicle, upsertAttachment, vehicleMeterHistory } from "../services/fleet.js";
import {
  addManualLine,
  addWorkToDraft,
  billableWork,
  cancelInvoice,
  createInvoiceDraft,
  getInvoice,
  issueInvoice,
  listInvoices,
  removeManualLine,
  removeWorkFromDraft,
  setDraftTax,
} from "../services/invoices.js";
import { listNotifications, markRead } from "../services/notifications.js";
import { createExpense, createMaintenance, listExpenses, listMaintenance, setMaintenanceStatus, updateMaintenance } from "../services/operations.js";
import { allocateCredit, getPayment, listPayments, PAYMENT_MODES, recordPayment } from "../services/payments.js";
import { approvePayrollRun, createAdjustment, createPayrollRun, decideAdjustment, discardDraftRun, listPayroll, markPayrollPaid, previewPayroll } from "../services/payroll.js";
import { billingReport, dashboard, driverEarningsReport, operatingHoursReport, outstandingReport, toCsv, utilizationReport } from "../services/reports.js";
import { reviewSubmission } from "../services/review.js";
import { auditLog, getAppSettings, getBusinessProfile, listTaxRules, saveTaxRule, updateAppSetting, updateBusinessProfile, verifyBusinessProfile, verifyTaxRule } from "../services/settings.js";
import { createAdminUser, listAdminUsers, resetAdminPassword, setAdminUserStatus, updateAdminUser } from "../services/users.js";

const id = z.object({ id: z.uuid() });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 1850 or 1850.50");
const hours = z.string().regex(/^\d{1,7}(\.\d)?$/, "Enter hours with at most one decimal");
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };
const optStr = z.string().trim().max(500).nullish();
const reason = z.object({ reason: z.string().trim().min(1).max(500) });
const range = () => {
  const { start, end } = monthRange(istDateString(new Date()).slice(0, 7));
  return { from: ymd.default(start), to: ymd.default(end) };
};
const statusList = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());

const WO_STATUSES = ["ASSIGNED", "ACCEPTED", "DECLINED", "IN_PROGRESS", "PENDING_APPROVAL", "CORRECTION_REQUIRED", "APPROVED", "CANCELLED"] as const;

export const adminRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  const { db } = deps;
  const act = (request: FastifyRequest) => actorFromAuth(requireAdmin(request));

  app.get("/me", async (request) => {
    const auth = requireAdmin(request, { allowPasswordChange: true });
    const user = await db.user.findUniqueOrThrow({ where: { id: auth.userId } });
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      permissions: ALL_MODULES.filter((m) => auth.permissions.has(m)),
      mustChangePassword: user.mustChangePassword,
    };
  });

  app.get("/dashboard", async (request) => dashboard(db, act(request)));

  app.get("/lookups", async (request) => {
    requireAdmin(request);
    const [customers, vehicles, drivers, attachments] = await Promise.all([
      db.customer.findMany({ where: { active: true }, include: { sites: { where: { active: true } } }, orderBy: { name: "asc" } }),
      db.vehicle.findMany({ where: { status: { not: "INACTIVE" } }, orderBy: { unitCode: "asc" } }),
      db.driver.findMany({ where: { status: "ACTIVE" }, orderBy: { fullName: "asc" } }),
      db.attachment.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    ]);
    return {
      customers: customers.map((c) => ({ id: c.id, name: c.name, sites: c.sites.map((s) => ({ id: s.id, name: s.name, address: s.address, contactName: s.contactName, contactPhone: s.contactPhone })) })),
      vehicles: vehicles.map((v) => ({ id: v.id, unitCode: v.unitCode, registrationNo: v.registrationNo, make: v.make, model: v.model, category: v.category, status: v.status })),
      drivers: drivers.map((d) => ({ id: d.id, driverCode: d.driverCode, fullName: d.fullName, phone: d.phone })),
      attachments: attachments.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, chargeable: a.chargeable })),
      categories: [...new Set(vehicles.map((v) => v.category))],
      paymentModes: PAYMENT_MODES,
    };
  });

  // ---- Notifications ----
  app.get("/notifications", async (request) => {
    const a = act(request);
    const q = z.object({ unread: z.enum(["true", "false"]).default("false") }).parse(request.query);
    return listNotifications(db, a.userId, { unreadOnly: q.unread === "true", limit: 100 });
  });
  app.post("/notifications/:id/read", async (request, reply) => {
    await markRead(db, act(request).userId, id.parse(request.params).id);
    return reply.status(204).send();
  });
  app.post("/notifications/read-all", async (request, reply) => {
    await markRead(db, act(request).userId, "all");
    return reply.status(204).send();
  });

  // ---- Work orders & meter approval ----
  app.get("/work-orders", async (request) => {
    const q = z
      .object({
        status: statusList(WO_STATUSES),
        open: z.enum(["true"]).optional(),
        driverId: z.uuid().optional(),
        vehicleId: z.uuid().optional(),
        customerId: z.uuid().optional(),
        from: ymd.optional(),
        to: ymd.optional(),
        q: z.string().max(60).optional(),
        sort: z.enum(["workDate", "-workDate", "submittedAt"]).optional(),
        ...page,
      })
      .parse(request.query);
    return listWorkOrdersAdmin(db, act(request), { ...q, status: q.open ? OPEN_STATUSES : q.status });
  });
  app.get("/work-orders/:id", async (request) => getWorkOrderAdmin(db, act(request), id.parse(request.params).id));
  app.post("/work-orders", async (request, reply) => {
    const body = z
      .object({
        customerId: z.uuid(),
        vehicleId: z.uuid(),
        driverId: z.uuid(),
        workDate: ymd,
        siteId: z.uuid().optional(),
        siteName: z.string().trim().max(200).optional(),
        siteAddress: optStr.transform((v) => v ?? undefined),
        siteContactName: optStr.transform((v) => v ?? undefined),
        siteContactPhone: optStr.transform((v) => v ?? undefined),
        shiftLabel: z.string().max(60).optional(),
        instructions: z.string().max(2000).optional(),
        plannedHours: z.string().optional(),
        attachmentIds: z.array(z.uuid()).max(10).optional(),
      })
      .parse(request.body);
    const wo = await createWorkOrder(db, act(request), body);
    return reply.status(201).send(await getWorkOrderAdmin(db, act(request), wo.id));
  });
  app.post("/work-orders/:id/reassign", async (request) => {
    const body = z
      .object({ driverId: z.uuid().optional(), vehicleId: z.uuid().optional(), workDate: ymd.optional(), siteName: z.string().max(200).optional(), instructions: z.string().max(2000).optional(), reason: z.string().trim().min(1).max(500) })
      .parse(request.body);
    await reassignWorkOrder(db, act(request), id.parse(request.params).id, body);
    return getWorkOrderAdmin(db, act(request), id.parse(request.params).id);
  });
  app.post("/work-orders/:id/cancel", async (request) => {
    await cancelWorkOrder(db, act(request), id.parse(request.params).id, reason.parse(request.body).reason);
    return getWorkOrderAdmin(db, act(request), id.parse(request.params).id);
  });
  app.post("/work-orders/:id/review", async (request) => {
    const body = z
      .discriminatedUnion("decision", [
        z.object({
          decision: z.literal("APPROVED"),
          note: z.string().max(500).optional(),
          breakerHours: hours.optional(),
          adjustment: z.object({ kind: z.enum(["ROLLOVER", "METER_REPLACED", "ADMIN_CORRECTION"]), approvedHours: hours, reason: z.string().max(500) }).optional(),
        }),
        z.object({ decision: z.literal("REJECTED"), reason: z.string().max(500), correctionTarget: z.enum(["START", "END", "BOTH"]) }),
      ])
      .parse(request.body);
    await reviewSubmission(db, act(request), id.parse(request.params).id, body);
    return getWorkOrderAdmin(db, act(request), id.parse(request.params).id);
  });

  // ---- Fleet ----
  const vehicleBody = z.object({
    unitCode: z.string().trim().min(1).max(20),
    registrationNo: z.string().trim().min(4).max(20),
    make: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(80),
    category: z.string().trim().min(1).max(60),
    year: z.number().int().nullish(),
    chassisNo: optStr,
    engineNo: optStr,
    insuranceExpiry: ymd.nullish(),
    fitnessExpiry: ymd.nullish(),
    notes: optStr,
  });
  app.get("/vehicles", async (request) => {
    const q = z.object({ search: z.string().max(60).optional(), status: z.enum(["AVAILABLE", "ASSIGNED", "WORKING", "MAINTENANCE", "INACTIVE"]).optional(), category: z.string().max(60).optional() }).parse(request.query);
    return listVehicles(db, act(request), q);
  });
  app.get("/vehicles/:id", async (request) => getVehicle(db, act(request), id.parse(request.params).id));
  app.post("/vehicles", async (request, reply) => {
    const body = vehicleBody.extend({ hourlyRate: money.optional(), rateEffectiveFrom: ymd.optional() }).parse(request.body);
    const v = await createVehicle(db, act(request), body);
    return reply.status(201).send(await getVehicle(db, act(request), v.id));
  });
  app.patch("/vehicles/:id", async (request) => {
    await updateVehicle(db, act(request), id.parse(request.params).id, vehicleBody.partial().parse(request.body));
    return getVehicle(db, act(request), id.parse(request.params).id);
  });
  app.post("/vehicles/:id/status", async (request) => {
    const body = z.object({ status: z.enum(["AVAILABLE", "MAINTENANCE", "INACTIVE"]), reason: z.string().trim().min(1).max(500) }).parse(request.body);
    await setVehicleStatus(db, act(request), id.parse(request.params).id, body.status, body.reason);
    return getVehicle(db, act(request), id.parse(request.params).id);
  });
  app.post("/vehicles/:id/rates", async (request) => {
    await addVehicleRate(db, act(request), id.parse(request.params).id, z.object({ hourlyRate: money, effectiveFrom: ymd }).parse(request.body));
    return getVehicle(db, act(request), id.parse(request.params).id);
  });
  app.get("/vehicles/:id/meter-history", async (request) =>
    vehicleMeterHistory(db, act(request), id.parse(request.params).id, z.object({ from: ymd.optional(), to: ymd.optional() }).parse(request.query)),
  );

  const attachmentBody = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(120), type: z.string().trim().min(1).max(60), chargeable: z.boolean(), notes: optStr, active: z.boolean().optional() });
  app.get("/attachments", async (request) => listAttachments(db, act(request)));
  app.get("/attachments/:id", async (request) => getAttachment(db, act(request), id.parse(request.params).id));
  app.post("/attachments", async (request, reply) => {
    const a = await upsertAttachment(db, act(request), null, attachmentBody.parse(request.body));
    return reply.status(201).send(await getAttachment(db, act(request), a.id));
  });
  app.patch("/attachments/:id", async (request) => {
    await upsertAttachment(db, act(request), id.parse(request.params).id, attachmentBody.partial().parse(request.body));
    return getAttachment(db, act(request), id.parse(request.params).id);
  });
  app.post("/attachments/:id/rates", async (request) => {
    await addAttachmentRate(db, act(request), id.parse(request.params).id, z.object({ hourlyCharge: money, effectiveFrom: ymd }).parse(request.body));
    return getAttachment(db, act(request), id.parse(request.params).id);
  });

  // ---- Customers ----
  const customerBody = z.object({
    name: z.string().trim().min(2).max(160),
    contactName: optStr,
    phone: optStr,
    email: optStr,
    address: optStr,
    gstin: optStr,
    stateCode: optStr,
    billingCycle: z.enum(["PER_WORK_ORDER", "DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]).optional(),
    paymentTermsDays: z.number().int().optional(),
    notes: optStr,
    active: z.boolean().optional(),
  });
  const siteBody = z.object({ name: z.string().trim().min(2).max(160), address: optStr, contactName: optStr, contactPhone: optStr, active: z.boolean().optional() });
  app.get("/customers", async (request) => {
    const q = z.object({ search: z.string().max(60).optional(), active: z.enum(["true", "false"]).optional() }).parse(request.query);
    return listCustomers(db, act(request), { search: q.search, active: q.active === undefined ? undefined : q.active === "true" });
  });
  app.get("/customers/:id", async (request) => getCustomer(db, act(request), id.parse(request.params).id));
  app.post("/customers", async (request, reply) => {
    const c = await saveCustomer(db, act(request), null, customerBody.parse(request.body));
    return reply.status(201).send(await getCustomer(db, act(request), c.id));
  });
  app.patch("/customers/:id", async (request) => {
    await saveCustomer(db, act(request), id.parse(request.params).id, customerBody.partial().parse(request.body));
    return getCustomer(db, act(request), id.parse(request.params).id);
  });
  app.post("/customers/:id/sites", async (request) => {
    await saveSite(db, act(request), id.parse(request.params).id, null, siteBody.parse(request.body));
    return getCustomer(db, act(request), id.parse(request.params).id);
  });
  app.patch("/customers/:id/sites/:siteId", async (request) => {
    const p = z.object({ id: z.uuid(), siteId: z.uuid() }).parse(request.params);
    await saveSite(db, act(request), p.id, p.siteId, siteBody.partial().parse(request.body));
    return getCustomer(db, act(request), p.id);
  });
  app.post("/customers/:id/rates", async (request) => {
    const body = z.object({ vehicleId: z.uuid().optional(), category: z.string().max(60).optional(), hourlyRate: money, effectiveFrom: ymd }).parse(request.body);
    await addCustomerRate(db, act(request), id.parse(request.params).id, body);
    return getCustomer(db, act(request), id.parse(request.params).id);
  });
  app.post("/customers/:id/attachment-rates", async (request) => {
    const body = z.object({ attachmentId: z.uuid(), hourlyCharge: money, effectiveFrom: ymd }).parse(request.body);
    await addCustomerAttachmentRate(db, act(request), id.parse(request.params).id, body);
    return getCustomer(db, act(request), id.parse(request.params).id);
  });

  // ---- Drivers ----
  const driverBody = z.object({ fullName: z.string().trim().min(2).max(120), phone: z.string().trim().max(20), emergencyContact: optStr, licenseNumber: optStr, licenseExpiry: ymd.nullish(), joinedOn: ymd.nullish(), address: optStr });
  const compensationBody = z.object({ method: z.enum(["HOURLY", "FIXED"]), hourlyRate: money.optional(), monthlySalary: money.optional(), effectiveFrom: ymd, note: z.string().max(500).optional() });
  app.get("/drivers", async (request) => {
    const q = z.object({ search: z.string().max(60).optional(), status: z.enum(["ACTIVE", "ON_LEAVE", "INACTIVE"]).optional() }).parse(request.query);
    return listDrivers(db, act(request), q);
  });
  app.get("/drivers/:id", async (request) => getDriver(db, act(request), id.parse(request.params).id));
  app.post("/drivers", async (request, reply) => {
    const body = driverBody.extend({ compensation: compensationBody.optional() }).parse(request.body);
    const res = await createDriver(db, act(request), body);
    return reply.status(201).send({ driver: await getDriver(db, act(request), res.driver.id), temporaryPin: res.temporaryPin });
  });
  app.patch("/drivers/:id", async (request) => {
    await updateDriver(db, act(request), id.parse(request.params).id, driverBody.partial().parse(request.body));
    return getDriver(db, act(request), id.parse(request.params).id);
  });
  app.post("/drivers/:id/status", async (request) => {
    const body = z.object({ status: z.enum(["ACTIVE", "ON_LEAVE", "INACTIVE"]), reason: z.string().trim().min(1).max(500) }).parse(request.body);
    await setDriverStatus(db, act(request), id.parse(request.params).id, body.status, body.reason);
    return getDriver(db, act(request), id.parse(request.params).id);
  });
  app.post("/drivers/:id/reset-pin", async (request) => resetDriverPin(db, act(request), id.parse(request.params).id));
  app.post("/drivers/:id/compensation", async (request) => {
    await addCompensation(db, act(request), id.parse(request.params).id, compensationBody.parse(request.body));
    return getDriver(db, act(request), id.parse(request.params).id);
  });
  app.get("/drivers/:id/work-history", async (request) =>
    driverWorkHistory(db, act(request), id.parse(request.params).id, z.object({ from: ymd.optional(), to: ymd.optional() }).parse(request.query)),
  );
  app.post("/drivers/:id/adjustments", async (request, reply) => {
    const body = z.object({ kind: z.enum(["ADDITION", "DEDUCTION"]), amount: money, description: z.string().max(300), effectiveOn: ymd }).parse(request.body);
    const a = await createAdjustment(db, act(request), id.parse(request.params).id, body);
    return reply.status(201).send({ id: a.id });
  });

  // ---- Invoices ----
  app.get("/invoices", async (request) => {
    const q = z
      .object({ status: statusList(["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED", "OVERDUE"] as const), customerId: z.uuid().optional(), search: z.string().max(60).optional(), from: ymd.optional(), to: ymd.optional(), ...page })
      .parse(request.query);
    return listInvoices(db, act(request), q);
  });
  app.get("/invoices/billable", async (request) => billableWork(db, act(request), z.object({ customerId: z.uuid(), ...range() }).parse(request.query)));
  app.post("/invoices", async (request, reply) => {
    const body = z
      .object({ customerId: z.uuid(), kind: z.enum(["TAX_INVOICE", "PROFORMA"]), periodStart: ymd, periodEnd: ymd, approvedWorkIds: z.array(z.uuid()).min(1).max(500), idempotencyKey: z.uuid(), notes: z.string().max(1000).optional() })
      .parse(request.body);
    return reply.status(201).send(await createInvoiceDraft(db, act(request), body));
  });
  app.get("/invoices/:id", async (request) => getInvoice(db, act(request), id.parse(request.params).id));
  app.post("/invoices/:id/work", async (request) => addWorkToDraft(db, act(request), id.parse(request.params).id, z.object({ approvedWorkIds: z.array(z.uuid()).min(1) }).parse(request.body).approvedWorkIds));
  app.delete("/invoices/:id/work/:workId", async (request) => {
    const p = z.object({ id: z.uuid(), workId: z.uuid() }).parse(request.params);
    return removeWorkFromDraft(db, act(request), p.id, p.workId);
  });
  app.post("/invoices/:id/lines", async (request) =>
    addManualLine(db, act(request), id.parse(request.params).id, z.object({ kind: z.enum(["OTHER", "DISCOUNT"]), description: z.string().max(300), amount: money }).parse(request.body)),
  );
  app.delete("/invoices/:id/lines/:lineId", async (request) => {
    const p = z.object({ id: z.uuid(), lineId: z.uuid() }).parse(request.params);
    return removeManualLine(db, act(request), p.id, p.lineId);
  });
  app.post("/invoices/:id/tax", async (request) =>
    setDraftTax(db, act(request), id.parse(request.params).id, z.object({ taxRuleId: z.uuid().nullable(), split: z.enum(["INTRA_STATE", "INTER_STATE", "NONE"]) }).parse(request.body)),
  );
  app.post("/invoices/:id/issue", async (request) => issueInvoice(db, act(request), id.parse(request.params).id, z.object({ issueDate: ymd.optional() }).parse(request.body ?? {})));
  app.post("/invoices/:id/cancel", async (request) => cancelInvoice(db, act(request), id.parse(request.params).id, reason.parse(request.body).reason));

  // ---- Payments ----
  app.get("/payments", async (request) => listPayments(db, act(request), z.object({ customerId: z.uuid().optional(), from: ymd.optional(), to: ymd.optional(), ...page }).parse(request.query)));
  app.get("/payments/:id", async (request) => getPayment(db, act(request), id.parse(request.params).id));
  app.post("/payments", async (request, reply) => {
    const body = z
      .object({
        customerId: z.uuid(),
        receivedOn: ymd,
        amount: money,
        mode: z.enum(PAYMENT_MODES),
        reference: z.string().max(80).optional(),
        notes: z.string().max(500).optional(),
        idempotencyKey: z.uuid(),
        allocations: z.array(z.object({ invoiceId: z.uuid(), amount: money })).max(50),
      })
      .parse(request.body);
    const res = await recordPayment(db, act(request), body);
    return reply.status(res.replayed ? 200 : 201).send(res);
  });
  app.post("/payments/:id/allocate", async (request) => allocateCredit(db, act(request), id.parse(request.params).id, z.object({ invoiceId: z.uuid(), amount: money }).parse(request.body)));

  // ---- Payroll ----
  app.get("/payroll", async (request) => listPayroll(db, act(request), z.object({ driverId: z.uuid().optional(), status: z.enum(["DRAFT", "APPROVED", "PAID"]).optional() }).parse(request.query)));
  app.get("/payroll/preview", async (request) => {
    const q = z.object({ driverId: z.uuid(), ...range() }).parse(request.query);
    return previewPayroll(db, act(request), q.driverId, { start: q.from, end: q.to });
  });
  app.post("/payroll", async (request, reply) => {
    const b = z.object({ driverId: z.uuid(), periodStart: ymd, periodEnd: ymd }).parse(request.body);
    const run = await createPayrollRun(db, act(request), b.driverId, { start: b.periodStart, end: b.periodEnd });
    return reply.status(201).send({ id: run.id });
  });
  app.post("/payroll/:id/approve", async (request, reply) => {
    await approvePayrollRun(db, act(request), id.parse(request.params).id);
    return reply.status(204).send();
  });
  app.post("/payroll/:id/paid", async (request, reply) => {
    await markPayrollPaid(db, act(request), id.parse(request.params).id, z.object({ paidOn: ymd, mode: z.enum(PAYMENT_MODES), reference: z.string().max(80).optional() }).parse(request.body));
    return reply.status(204).send();
  });
  app.delete("/payroll/:id", async (request, reply) => {
    await discardDraftRun(db, act(request), id.parse(request.params).id);
    return reply.status(204).send();
  });
  app.post("/adjustments/:id/decision", async (request, reply) => {
    const b = z.object({ decision: z.enum(["APPROVED", "VOID"]), reason: z.string().max(500).optional() }).parse(request.body);
    await decideAdjustment(db, act(request), id.parse(request.params).id, b.decision, b.reason);
    return reply.status(204).send();
  });

  // ---- Maintenance & expenses ----
  const maintenanceBody = z.object({ vehicleId: z.uuid(), title: z.string().trim().min(2).max(160), category: z.string().trim().min(2).max(60), description: optStr, scheduledOn: ymd.nullish(), meterReading: hours.nullish(), vendor: optStr, cost: money.nullish() });
  app.get("/maintenance", async (request) =>
    listMaintenance(db, act(request), z.object({ vehicleId: z.uuid().optional(), status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional() }).parse(request.query)),
  );
  app.post("/maintenance", async (request, reply) => reply.status(201).send(await createMaintenance(db, act(request), maintenanceBody.parse(request.body))));
  app.patch("/maintenance/:id", async (request) => updateMaintenance(db, act(request), id.parse(request.params).id, maintenanceBody.omit({ vehicleId: true }).partial().parse(request.body)));
  app.post("/maintenance/:id/status", async (request) => {
    const b = z.object({ status: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]), cost: money.optional(), note: z.string().max(500).optional() }).parse(request.body);
    return setMaintenanceStatus(db, act(request), id.parse(request.params).id, b.status, b);
  });
  app.get("/expenses", async (request) =>
    listExpenses(db, act(request), z.object({ from: ymd.optional(), to: ymd.optional(), category: z.string().max(60).optional(), vehicleId: z.uuid().optional() }).parse(request.query)),
  );
  app.post("/expenses", async (request, reply) => {
    const b = z.object({ category: z.string().trim().min(2).max(60), vehicleId: z.uuid().nullish(), spentOn: ymd, amount: money, description: z.string().max(300), vendor: z.string().max(120).optional(), reference: z.string().max(80).optional() }).parse(request.body);
    const e = await createExpense(db, act(request), b);
    return reply.status(201).send({ id: e.id });
  });

  // ---- Reports (JSON or CSV) ----
  app.get("/reports/:kind", async (request, reply) => {
    const { kind } = z.object({ kind: z.enum(["operating-hours", "utilization", "billing", "outstanding", "driver-earnings"]) }).parse(request.params);
    const q = z.object({ ...range(), groupBy: z.enum(["vehicle", "driver", "customer"]).default("vehicle"), format: z.enum(["json", "csv"]).default("json") }).parse(request.query);
    const a = act(request);
    const r = { from: q.from, to: q.to };
    const data =
      kind === "operating-hours"
        ? await operatingHoursReport(db, a, r, q.groupBy)
        : kind === "utilization"
          ? await utilizationReport(db, a, r)
          : kind === "billing"
            ? await billingReport(db, a, r)
            : kind === "outstanding"
              ? await outstandingReport(db, a)
              : await driverEarningsReport(db, a, r);
    if (q.format === "csv") {
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="aj-${kind}-${q.from}-to-${q.to}.csv"`)
        .send("﻿" + toCsv(data.rows as unknown as Record<string, unknown>[]));
    }
    return data;
  });

  // ---- Users & settings ----
  const adminRole = z.enum(["OWNER", "MANAGER", "ACCOUNTS"]);
  const modules = z.array(z.enum(ALL_MODULES as [string, ...string[]])).max(ALL_MODULES.length) as unknown as z.ZodType<(typeof ALL_MODULES)[number][]>;
  app.get("/users", async (request) => listAdminUsers(db, act(request)));
  app.post("/users", async (request, reply) => {
    const b = z.object({ displayName: z.string().max(120), email: z.string().max(160), phone: z.string().max(20).optional(), role: adminRole, permissions: modules.optional() }).parse(request.body);
    return reply.status(201).send(await createAdminUser(db, act(request), b));
  });
  app.patch("/users/:id", async (request, reply) => {
    const b = z.object({ role: adminRole.optional(), permissions: modules.optional(), displayName: z.string().max(120).optional(), phone: z.string().max(20).nullish() }).parse(request.body);
    await updateAdminUser(db, act(request), id.parse(request.params).id, b);
    return reply.status(204).send();
  });
  app.post("/users/:id/status", async (request, reply) => {
    const b = z.object({ active: z.boolean(), reason: z.string().trim().min(1).max(500) }).parse(request.body);
    await setAdminUserStatus(db, act(request), id.parse(request.params).id, b.active, b.reason);
    return reply.status(204).send();
  });
  app.post("/users/:id/reset-password", async (request) => resetAdminPassword(db, act(request), id.parse(request.params).id));

  const profileBody = z.object({ legalName: optStr, tradeName: optStr, gstin: optStr, stateCode: optStr, address: optStr, phone: optStr, email: optStr, bankDetails: optStr, invoicePrefix: z.string().max(8).optional(), invoiceTerms: z.string().max(2000).nullish() });
  const ruleBody = z.object({ name: z.string().trim().min(2).max(120), sacCode: optStr, cgstRate: z.string().nullish(), sgstRate: z.string().nullish(), igstRate: z.string().nullish(), notes: optStr, active: z.boolean().optional() });
  const confirmation = z.object({ confirmation: z.string().max(500) });
  app.get("/settings/business", async (request) => getBusinessProfile(db, act(request)));
  app.put("/settings/business", async (request) => updateBusinessProfile(db, act(request), profileBody.parse(request.body) as never));
  app.post("/settings/business/verify", async (request) => verifyBusinessProfile(db, act(request), confirmation.parse(request.body).confirmation));
  app.get("/settings/tax-rules", async (request) => listTaxRules(db, act(request)));
  app.post("/settings/tax-rules", async (request, reply) => reply.status(201).send(await saveTaxRule(db, act(request), null, ruleBody.parse(request.body))));
  app.patch("/settings/tax-rules/:id", async (request) => saveTaxRule(db, act(request), id.parse(request.params).id, ruleBody.partial().parse(request.body)));
  app.post("/settings/tax-rules/:id/verify", async (request) => verifyTaxRule(db, act(request), id.parse(request.params).id, confirmation.parse(request.body).confirmation));
  app.get("/settings/app", async (request) => getAppSettings(db, act(request)));
  app.get("/settings/storage", async (request) => {
    assertCan(act(request), "SETTINGS");
    return photoStorageUsage(db);
  });
  app.put("/settings/app/:key", async (request, reply) => {
    const { key } = z.object({ key: z.string().max(60) }).parse(request.params);
    await updateAppSetting(db, act(request), key, z.object({ value: z.string().max(40).nullable() }).parse(request.body).value);
    return reply.status(204).send();
  });
  app.get("/audit-log", async (request) =>
    auditLog(db, act(request), z.object({ entityType: z.string().max(40).optional(), entityId: z.string().max(60).optional(), ...page }).parse(request.query)),
  );
};

