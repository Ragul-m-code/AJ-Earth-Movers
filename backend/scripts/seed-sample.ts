// SAMPLE DATA ONLY. Creates clearly labelled demo records (isSample = true, names suffixed "(Sample)")
// so both apps can be exercised end to end. Never run against a production database.
//
// Sample sign-in credentials (test values for this app only, local development):
//   Driver app (hourly):      DRV-104 / PIN 246810
//   Driver app (fixed salary): DRV-105 / PIN 135790
//   Admin app owner:          owner@sample.ajem.test    / SampleOwner#2026
//   Admin app manager:        manager@sample.ajem.test  / SampleManager#2026
//   Admin app accounts:       accounts@sample.ajem.test / SampleAccounts#2026
// No business profile or tax rule is verified: tax setup is left for the real accountant.
import "../src/loadEnv.js";
import { Prisma } from "@prisma/client";
import { createDb } from "../src/db.js";
import { dateOnly, istDateString } from "../src/domain/time.js";
import { hashSecret } from "../src/lib/auth.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/permissions.js";
import { localPhotoStorage } from "../src/lib/storage.js";
import { loadActor } from "../src/services/actor.js";
import { createWorkOrder } from "../src/services/assignments.js";
import { reviewSubmission } from "../src/services/review.js";
import { SAMPLE_PHOTO_PNG } from "./samplePhoto.js";

if (process.env.NODE_ENV === "production" || process.env.VERCEL) throw new Error("Refusing to seed sample data in production.");
// Sample accounts have published passwords: never let them reach a database that is not on this machine.
const dbHost = new URL(process.env.DATABASE_URL ?? "postgresql://localhost").hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(dbHost)) throw new Error(`Refusing to seed sample data into a remote database (${dbHost}).`);

const db = createDb();
const storage = localPhotoStorage(process.env.PHOTO_STORAGE_DIR ?? "./storage/photos");

if (await db.driver.findUnique({ where: { driverCode: "DRV-104" } })) {
  console.log("Sample data already present. To reset the local database: npx prisma migrate reset (deletes ALL local data).");
  process.exit(0);
}

const daysAgo = (n: number) => istDateString(new Date(Date.now() - n * 86_400_000));
const today = daysAgo(0);
const D = (v: string) => new Prisma.Decimal(v);

async function adminUser(email: string, name: string, role: "OWNER" | "MANAGER" | "ACCOUNTS", password: string) {
  const u = await db.user.create({ data: { loginId: email, email, displayName: name, role, passwordHash: await hashSecret(password) } });
  if (role !== "OWNER") await db.userPermission.createMany({ data: DEFAULT_PERMISSIONS[role].map((module) => ({ userId: u.id, module })) });
  return u;
}
const owner = await adminUser("owner@sample.ajem.test", "Sample Owner", "OWNER", "SampleOwner#2026");
const manager = await adminUser("manager@sample.ajem.test", "Sample Manager", "MANAGER", "SampleManager#2026");
await adminUser("accounts@sample.ajem.test", "Sample Accounts", "ACCOUNTS", "SampleAccounts#2026");
const managerActor = await loadActor(db, manager.id);

async function driver(code: string, name: string, pin: string, compensation: Prisma.DriverCompensationCreateWithoutDriverInput[]) {
  const user = await db.user.create({ data: { loginId: code, passwordHash: await hashSecret(pin), displayName: name, role: "DRIVER", phone: "+919000000" + code.slice(-3) } });
  return db.driver.create({
    data: {
      userId: user.id, driverCode: code, fullName: name, phone: `+91 90000 00${code.slice(-3)}`, emergencyContact: "Sample contact +91 90000 00999",
      licenseNumber: "SAMPLE-DL-0000", joinedOn: dateOnly("2020-06-01"), isSample: true, compensation: { create: compensation },
    },
    include: { user: true },
  });
}
const ramesh = await driver("DRV-104", "Ramesh Kumar (Sample)", "246810", [
  { method: "HOURLY", hourlyRate: D("140.00"), effectiveFrom: dateOnly("2026-01-01"), note: "Sample rate", createdById: owner.id },
  { method: "HOURLY", hourlyRate: D("150.00"), effectiveFrom: dateOnly(daysAgo(3)), note: "Sample rate revision", createdById: owner.id },
]);
await driver("DRV-105", "Suresh Patil (Sample)", "135790", [
  { method: "FIXED", monthlySalary: D("24000.00"), effectiveFrom: dateOnly("2026-01-01"), note: "Sample fixed salary", createdById: owner.id },
]);

const tata = await db.customer.create({
  data: { name: "Tata Infra Projects (Sample)", contactName: "Site office", phone: "+91 90000 00201", stateCode: "27", billingCycle: "MONTHLY", paymentTermsDays: 30, isSample: true,
    sites: { create: [{ name: "Hinjawadi Phase 3 (Sample)", address: "Sample address, Hinjawadi, Pune", contactName: "Site supervisor (Sample)" }, { name: "Wakad yard (Sample)" }, { name: "Ring Road Package 3 (Sample)" }] } },
  include: { sites: true },
});
const lnt = await db.customer.create({
  data: { name: "L&T Metro Works (Sample)", stateCode: "27", billingCycle: "PER_WORK_ORDER", paymentTermsDays: 15, isSample: true, sites: { create: [{ name: "Pune Metro Line 4 (Sample)" }] } },
  include: { sites: true },
});

const jcb = await db.vehicle.create({
  data: { unitCode: "UNIT-08", registrationNo: "MH-12-SA-0008", make: "JCB", model: "3DX Backhoe Loader", category: "Backhoe loader", year: 2021, isSample: true,
    rates: { create: { hourlyRate: D("1100.00"), effectiveFrom: dateOnly("2026-01-01"), createdById: owner.id } } },
});
const excavator = await db.vehicle.create({
  data: { unitCode: "UNIT-15", registrationNo: "MH-14-SA-0015", make: "CAT", model: "320D Excavator", category: "Crawler excavator", year: 2019, isSample: true,
    rates: { create: { hourlyRate: D("1800.00"), effectiveFrom: dateOnly("2026-01-01"), createdById: owner.id } } },
});
await db.vehicle.create({ data: { unitCode: "UNIT-21", registrationNo: "MH-12-SA-0021", make: "JCB", model: "3DX Super", category: "Backhoe loader", status: "AVAILABLE", isSample: true } });
const breaker = await db.attachment.create({
  data: { code: "BRK-01", name: "Hydraulic Rock Breaker (Sample)", type: "Breaker", chargeable: true, isSample: true,
    rates: { create: { hourlyCharge: D("400.00"), effectiveFrom: dateOnly("2026-01-01"), createdById: owner.id } } },
});
const bucket = await db.attachment.create({ data: { code: "BKT-02", name: "Trenching Bucket 0.26 m³ (Sample)", type: "Bucket", isSample: true } });

// Customer-agreed rates (sample): Tata pays ₹1,250/h for backhoes; L&T agreed ₹450/h for the breaker.
await db.customerRate.create({ data: { customerId: tata.id, category: "Backhoe loader", hourlyRate: D("1250.00"), effectiveFrom: dateOnly("2026-01-01"), createdById: owner.id } });
await db.customerAttachmentRate.create({ data: { customerId: lnt.id, attachmentId: breaker.id, hourlyCharge: D("450.00"), effectiveFrom: dateOnly("2026-01-01"), createdById: owner.id } });

// Placeholder tax rule left UNVERIFIED on purpose: the accountant must enter and verify the real treatment.
await db.taxRule.create({ data: { name: "Placeholder: enter verified GST treatment (Sample)", notes: "Sample only. Rates intentionally blank until confirmed by the accountant.", createdById: owner.id } });

async function backdatedReading(workOrderId: string, kind: "START" | "END", value: string, at: Date) {
  const stored = await storage.put(SAMPLE_PHOTO_PNG, "png");
  const photo = await db.photo.create({ data: { workOrderId, storageKey: stored.key, mimeType: "image/png", sizeBytes: SAMPLE_PHOTO_PNG.length, sha256: stored.sha256, uploadedById: ramesh.userId, uploadedAt: at } });
  await db.meterReading.create({ data: { workOrderId, kind, revision: 1, value: D(value), photoId: photo.id, flags: [], submittedById: ramesh.userId, submittedAt: at, idempotencyKey: crypto.randomUUID() } });
}

async function completedJob(o: { date: string; vehicleId: string; customerId: string; siteId: string; start: string; end: string; hourIst: number; hours: number; attachmentIds?: string[] }) {
  const wo = await createWorkOrder(db, managerActor, { customerId: o.customerId, vehicleId: o.vehicleId, driverId: ramesh.id, workDate: o.date, siteId: o.siteId, shiftLabel: "Day shift", attachmentIds: o.attachmentIds, isSample: true });
  const startAt = new Date(`${o.date}T${String(o.hourIst).padStart(2, "0")}:00:00+05:30`);
  const endAt = new Date(startAt.getTime() + (o.hours + 0.5) * 3_600_000);
  await backdatedReading(wo.id, "START", o.start, startAt);
  await backdatedReading(wo.id, "END", o.end, endAt);
  await db.workOrder.update({ where: { id: wo.id }, data: { status: "PENDING_APPROVAL", respondedAt: startAt, startedAt: startAt, submittedAt: endAt } });
  await db.workOrderEvent.createMany({
    data: [
      { workOrderId: wo.id, fromStatus: "ASSIGNED", toStatus: "ACCEPTED", actorId: ramesh.userId, createdAt: startAt },
      { workOrderId: wo.id, fromStatus: "ACCEPTED", toStatus: "IN_PROGRESS", actorId: ramesh.userId, createdAt: startAt },
      { workOrderId: wo.id, fromStatus: "IN_PROGRESS", toStatus: "PENDING_APPROVAL", actorId: ramesh.userId, createdAt: endAt },
    ],
  });
  return wo;
}

const [hinjawadi, wakad, ringRoad] = tata.sites;
const metro = lnt.sites[0]!;
const a = await completedJob({ date: daysAgo(6), vehicleId: jcb.id, customerId: tata.id, siteId: hinjawadi!.id, start: "1241.0", end: "1245.5", hourIst: 8, hours: 4.5 });
const b = await completedJob({ date: daysAgo(6), vehicleId: jcb.id, customerId: tata.id, siteId: wakad!.id, start: "1245.5", end: "1250.0", hourIst: 14, hours: 4.5 });
const c = await completedJob({ date: daysAgo(4), vehicleId: excavator.id, customerId: lnt.id, siteId: metro.id, start: "3403.5", end: "3412.0", hourIst: 7, hours: 8.5, attachmentIds: [breaker.id] });
for (const wo of [a, b, c]) await reviewSubmission(db, managerActor, wo.id, { decision: "APPROVED" });

const d = await completedJob({ date: daysAgo(2), vehicleId: excavator.id, customerId: lnt.id, siteId: metro.id, start: "3412.0", end: "3420.5", hourIst: 7, hours: 8.5, attachmentIds: [breaker.id] });
await reviewSubmission(db, managerActor, d.id, { decision: "REJECTED", correctionTarget: "END", reason: "Sample rejection: the last digit of the ending meter is not readable in the photo. Please retake it." });
await completedJob({ date: daysAgo(1), vehicleId: jcb.id, customerId: tata.id, siteId: ringRoad!.id, start: "1250.0", end: "1259.0", hourIst: 8, hours: 9 });

await createWorkOrder(db, managerActor, {
  customerId: tata.id, vehicleId: jcb.id, driverId: ramesh.id, workDate: today, siteId: hinjawadi!.id, shiftLabel: "Day shift",
  plannedHours: "8", instructions: "Sample job: trench excavation along the service road.", attachmentIds: [bucket.id], isSample: true,
});
await createWorkOrder(db, managerActor, {
  customerId: lnt.id, vehicleId: excavator.id, driverId: ramesh.id, workDate: daysAgo(-1), siteId: metro.id, shiftLabel: "Day shift",
  plannedHours: "10", instructions: "Sample job: rock breaking at pier 18.", attachmentIds: [breaker.id], isSample: true,
});
await db.maintenanceRecord.create({ data: { vehicleId: jcb.id, title: "500-hour service (Sample)", category: "Preventive service", scheduledOn: dateOnly(daysAgo(-5)), createdById: owner.id } });
await db.expense.create({ data: { category: "Fuel (HSD)", vehicleId: jcb.id, spentOn: dateOnly(daysAgo(2)), amount: D("4500.00"), description: "Sample diesel top-up", createdById: owner.id } });

console.log("Sample data created. Credentials are listed at the top of scripts/seed-sample.ts.");
await db.$disconnect();
