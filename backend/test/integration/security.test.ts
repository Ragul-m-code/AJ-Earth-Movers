// Security regressions: access control across drivers, account lifecycle, brute force and export safety.
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db.js";
import { toCsv } from "../../src/services/reports.js";
import { reviewSubmission } from "../../src/services/review.js";
import { adminLogin, fixtures, loginAs, readingForm, resetDb, setupTestApp, submittedViaApi } from "./helpers.js";

let app: FastifyInstance;
let db: Db;
let f: Awaited<ReturnType<typeof fixtures>>;

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
});

describe("cross-driver access", () => {
  it("a driver cannot read, accept or view photos of another driver's job", async () => {
    const d1 = await loginAs(app, "DRV-1", "123456");
    const d2 = await loginAs(app, "DRV-2", "654321");
    const wo = await f.newWorkOrder(f.d1.driver.id);
    await submittedViaApi(app, db, d1, wo.id, "100.0", "105.0");
    const photo = await db.photo.findFirstOrThrow({ where: { workOrderId: wo.id } });

    expect((await app.inject({ method: "GET", url: `/api/driver/work-orders/${wo.id}`, headers: d2 })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/driver/work-orders/${wo.id}/accept`, headers: d2 })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/photos/${photo.id}`, headers: d2 })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/photos/${photo.id}`, headers: d1 })).statusCode).toBe(200);
  });

  it("a driver cannot submit readings to, or decline, another driver's job", async () => {
    const d2 = await loginAs(app, "DRV-2", "654321");
    const wo = await f.newWorkOrder(f.d1.driver.id);
    const form = readingForm({ kind: "START", value: "100.0", idempotencyKey: randomUUID() });
    const submit = await app.inject({ method: "POST", url: `/api/driver/work-orders/${wo.id}/readings`, headers: { ...d2, ...form.headers }, payload: form.payload });
    expect(submit.statusCode).toBe(404);
    const decline = await app.inject({ method: "POST", url: `/api/driver/work-orders/${wo.id}/decline`, headers: d2, payload: { reason: "not my job at all" } });
    expect(decline.statusCode).toBe(404);
    expect(await db.meterReading.count({ where: { workOrderId: wo.id } })).toBe(0);
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status).toBe("ASSIGNED");
  });

  it("job lists, earnings and notifications only ever show the signed-in driver's own data", async () => {
    const d1 = await loginAs(app, "DRV-1", "123456");
    const d2 = await loginAs(app, "DRV-2", "654321");
    const wo = await f.newWorkOrder(f.d1.driver.id);
    await submittedViaApi(app, db, d1, wo.id, "100.0", "105.0");
    await reviewSubmission(db, f.actors.manager, wo.id, { decision: "APPROVED" });

    const list = await app.inject({ method: "GET", url: "/api/driver/work-orders", headers: d2 });
    expect(JSON.stringify(list.json())).not.toContain(wo.id);
    const earnings = await app.inject({ method: "GET", url: "/api/driver/earnings", headers: d2 });
    expect(JSON.stringify(earnings.json())).not.toContain(wo.code);
    const summary = await app.inject({ method: "GET", url: "/api/driver/summary?month=2026-10", headers: d2 });
    expect(JSON.stringify(summary.json())).not.toContain("5.0");

    // Driver 1 was notified of the assignment; driver 2 can neither see nor mark it.
    const note = await db.notification.findFirstOrThrow({ where: { userId: f.d1.user.id } });
    const notes = await app.inject({ method: "GET", url: "/api/driver/notifications", headers: d2 });
    expect(JSON.stringify(notes.json())).not.toContain(note.id);
    expect((await app.inject({ method: "POST", url: `/api/driver/notifications/${note.id}/read`, headers: d2 })).statusCode).toBe(404);
    expect((await db.notification.findUniqueOrThrow({ where: { id: note.id } })).readAt).toBeNull();
  });

  it("a driver token cannot call admin endpoints, and no token means 401", async () => {
    const d1 = await loginAs(app, "DRV-1", "123456");
    expect((await app.inject({ method: "GET", url: "/api/admin/drivers", headers: d1 })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/admin/drivers" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/admin/drivers", headers: { authorization: "Bearer forged-token" } })).statusCode).toBe(401);
  });
});

describe("account lifecycle", () => {
  it("a deactivated driver's existing session stops working at once", async () => {
    const d2 = await loginAs(app, "DRV-2", "654321");
    expect((await app.inject({ method: "GET", url: "/api/driver/me", headers: d2 })).statusCode).toBe(200);
    // Deactivated directly in the database (not via the service that also revokes sessions).
    await db.driver.update({ where: { id: f.d2.driver.id }, data: { status: "INACTIVE" } });
    expect((await app.inject({ method: "GET", url: "/api/driver/me", headers: d2 })).statusCode).toBe(401);
  });

  it("an office user on a temporary password cannot view meter photos", async () => {
    const d1 = await loginAs(app, "DRV-1", "123456");
    const wo = await f.newWorkOrder(f.d1.driver.id);
    await submittedViaApi(app, db, d1, wo.id, "100.0", "105.0");
    const photo = await db.photo.findFirstOrThrow({ where: { workOrderId: wo.id } });
    const mgr = await adminLogin(app, "manager@test.local");
    expect((await app.inject({ method: "GET", url: `/api/photos/${photo.id}`, headers: mgr })).statusCode).toBe(200);
    await db.user.update({ where: { id: f.manager.id }, data: { mustChangePassword: true } });
    const res = await app.inject({ method: "GET", url: `/api/photos/${photo.id}`, headers: mgr });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });
});

describe("brute force", () => {
  it("parallel wrong PINs still lock the account after five failures", async () => {
    const tries = await Promise.all(
      Array.from({ length: 8 }, () => app.inject({ method: "POST", url: "/api/auth/driver/login", payload: { loginId: "DRV-2", pin: "000000" } })),
    );
    expect(tries.every((r) => r.statusCode === 401 || r.statusCode === 423)).toBe(true);
    const user = await db.user.findUniqueOrThrow({ where: { id: f.d2.user.id } });
    expect(user.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    // Even the correct PIN is refused while locked.
    const ok = await app.inject({ method: "POST", url: "/api/auth/driver/login", payload: { loginId: "DRV-2", pin: "654321" } });
    expect(ok.statusCode).toBe(423);
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formulas, including ones that start with a number", () => {
    const csv = toCsv([
      { a: "=HYPERLINK(\"http://x\")", b: "-1+HYPERLINK(\"http://x\")", c: "@SUM(A1)", d: "\t=cmd", e: "-12.50", f: "1250", g: "Tata, Pune" },
    ]);
    const row = csv.split("\n")[1]!;
    expect(row).toContain("'=HYPERLINK");
    expect(row).toContain("'-1+HYPERLINK");
    expect(row).toContain("'@SUM");
    expect(row).toContain("'\t=cmd");
    expect(row).toContain(",-12.50,1250,");
    expect(row).toContain('"Tata, Pune"');
  });
});
