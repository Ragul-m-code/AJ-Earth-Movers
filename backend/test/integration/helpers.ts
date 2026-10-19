import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createDb, type Db } from "../../src/db.js";
import { dateOnly } from "../../src/domain/time.js";
import { hashSecret } from "../../src/lib/auth.js";
import { DEFAULT_PERMISSIONS } from "../../src/lib/permissions.js";
import { localPhotoStorage } from "../../src/lib/storage.js";
import { loadActor } from "../../src/services/actor.js";
import { createWorkOrder } from "../../src/services/assignments.js";
import { SAMPLE_PHOTO_PNG } from "../../scripts/samplePhoto.js";

export const PHOTO = SAMPLE_PHOTO_PNG;
const D = (v: string) => new Prisma.Decimal(v);

export async function setupTestApp(): Promise<{ app: FastifyInstance; db: Db }> {
  process.loadEnvFile(".env");
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "ignore" });
  const db = createDb(url);
  const config = loadConfig({ ...process.env, DATABASE_URL: url, LOGIN_ATTEMPTS_PER_MINUTE: "1000" });
  const storage = localPhotoStorage(mkdtempSync(path.join(tmpdir(), "aj-photos-")));
  const app = await buildApp({ config, db, storage }, { logger: false });
  return { app, db };
}

export async function resetDb(db: Db) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

export const ADMIN_PASSWORD = "TestPassword123";

export async function fixtures(db: Db) {
  const admin = async (email: string, role: "OWNER" | "MANAGER" | "ACCOUNTS") => {
    const u = await db.user.create({ data: { loginId: email, email, displayName: email.split("@")[0]!, role, passwordHash: await hashSecret(ADMIN_PASSWORD) } });
    if (role !== "OWNER") await db.userPermission.createMany({ data: DEFAULT_PERMISSIONS[role].map((module) => ({ userId: u.id, module })) });
    return u;
  };
  const owner = await admin("owner@test.local", "OWNER");
  const manager = await admin("manager@test.local", "MANAGER");
  const accounts = await admin("accounts@test.local", "ACCOUNTS");
  const actors = { owner: await loadActor(db, owner.id), manager: await loadActor(db, manager.id), accounts: await loadActor(db, accounts.id) };

  const mkDriver = async (code: string, pin: string, compensation: Prisma.DriverCompensationCreateWithoutDriverInput[]) => {
    const user = await db.user.create({ data: { loginId: code, passwordHash: await hashSecret(pin), displayName: code, role: "DRIVER" } });
    const driver = await db.driver.create({ data: { userId: user.id, driverCode: code, fullName: `Driver ${code}`, phone: "+91 90000 00000", compensation: { create: compensation } } });
    return { user, driver };
  };
  const d1 = await mkDriver("DRV-1", "123456", [
    { method: "HOURLY", hourlyRate: D("140.00"), effectiveFrom: dateOnly("2026-01-01") },
    { method: "HOURLY", hourlyRate: D("150.00"), effectiveFrom: dateOnly("2026-10-15") },
  ]);
  const d2 = await mkDriver("DRV-2", "654321", [{ method: "HOURLY", hourlyRate: D("140.00"), effectiveFrom: dateOnly("2026-01-01") }]);
  const fixedDriver = await mkDriver("DRV-3", "111222", [{ method: "FIXED", monthlySalary: D("24000.00"), effectiveFrom: dateOnly("2026-01-01") }]);

  const customer = await db.customer.create({ data: { name: "Customer A", paymentTermsDays: 30, gstin: "27ABCDE1234F1Z5", stateCode: "27" } });
  const customer2 = await db.customer.create({ data: { name: "Customer B" } });
  const vehicle = await db.vehicle.create({
    data: { unitCode: "U-1", registrationNo: "MH-12-AA-0001", make: "JCB", model: "3DX", category: "Backhoe", rates: { create: { hourlyRate: D("1100.00"), effectiveFrom: dateOnly("2026-01-01") } } },
  });
  const vehicle2 = await db.vehicle.create({
    data: { unitCode: "U-2", registrationNo: "MH-12-AA-0002", make: "CAT", model: "320D", category: "Excavator", rates: { create: { hourlyRate: D("1800.00"), effectiveFrom: dateOnly("2026-01-01") } } },
  });
  const breaker = await db.attachment.create({
    data: { code: "BRK-1", name: "Breaker", type: "Breaker", chargeable: true, rates: { create: { hourlyCharge: D("400.00"), effectiveFrom: dateOnly("2026-01-01") } } },
  });
  // Customer A agreed ₹1,850/h for backhoes (customer rate, independent of driver pay).
  await db.customerRate.create({ data: { customerId: customer.id, category: "Backhoe", hourlyRate: D("1850.00"), effectiveFrom: dateOnly("2026-01-01") } });

  const newWorkOrder = (driverId: string, workDate = "2026-10-16", opts: { vehicleId?: string; customerId?: string; attachmentIds?: string[] } = {}) =>
    createWorkOrder(db, actors.manager, {
      customerId: opts.customerId ?? customer.id,
      vehicleId: opts.vehicleId ?? vehicle.id,
      driverId,
      workDate,
      siteName: "Site 1",
      attachmentIds: opts.attachmentIds,
    });
  return { owner, manager, accounts, actors, d1, d2, fixedDriver, customer, customer2, vehicle, vehicle2, breaker, newWorkOrder };
}

export async function loginAs(app: FastifyInstance, loginId: string, pin: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/driver/login", payload: { loginId, pin } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  return { authorization: `Bearer ${res.json().token}` };
}

export async function adminLogin(app: FastifyInstance, email: string, password = ADMIN_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/auth/admin/login", payload: { identifier: email, password } });
  if (res.statusCode !== 200) throw new Error(`admin login failed: ${res.body}`);
  return { authorization: `Bearer ${res.json().token}` };
}

/** Builds a multipart body by hand so tests exercise the exact wire format the app sends. */
export function readingForm(fields: Record<string, string>, photo: Buffer | null = PHOTO) {
  const boundary = "----ajtestboundary";
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (photo) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="meter.png"\r\nContent-Type: image/png\r\n\r\n`));
    chunks.push(photo, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

/** Puts a job straight into PENDING_APPROVAL with readings, for admin-side tests. */
export async function submittedViaApi(app: FastifyInstance, db: Db, auth: { authorization: string }, workOrderId: string, start: string, end: string) {
  await app.inject({ method: "POST", url: `/api/driver/work-orders/${workOrderId}/accept`, headers: auth });
  const send = (kind: string, value: string) => {
    const f = readingForm({ kind, value, idempotencyKey: crypto.randomUUID() });
    return app.inject({ method: "POST", url: `/api/driver/work-orders/${workOrderId}/readings`, headers: { ...auth, ...f.headers }, payload: f.payload });
  };
  if ((await send("START", start)).statusCode !== 201) throw new Error("start failed");
  await db.meterReading.updateMany({ where: { workOrderId, kind: "START" }, data: { submittedAt: new Date(Date.now() - 12 * 3_600_000) } });
  const r = await send("END", end);
  if (r.statusCode !== 201) throw new Error(`end failed: ${r.body}`);
}
