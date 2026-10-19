import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db.js";
import { hashSecret } from "../../src/lib/auth.js";
import { loadActor } from "../../src/services/actor.js";
import { reviewSubmission } from "../../src/services/review.js";
import { fixtures, loginAs, readingForm, resetDb, setupTestApp } from "./helpers.js";

let app: FastifyInstance;
let db: Db;
let f: Awaited<ReturnType<typeof fixtures>>;
let auth: { authorization: string };

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
  auth = await loginAs(app, "DRV-1", "123456");
});

const submit = (id: string, kind: "START" | "END", value: string, key = randomUUID(), photo?: Buffer | null) => {
  const form = readingForm({ kind, value, idempotencyKey: key }, photo === undefined ? undefined : photo);
  return app.inject({ method: "POST", url: `/api/driver/work-orders/${id}/readings`, headers: { ...auth, ...form.headers }, payload: form.payload });
};
const get = (id: string) => app.inject({ method: "GET", url: `/api/driver/work-orders/${id}`, headers: auth }).then((r) => r.json());
const accept = (id: string) => app.inject({ method: "POST", url: `/api/driver/work-orders/${id}/accept`, headers: auth });

/** Moves the start reading back in time so the elapsed-time check sees a realistic shift. */
const backdateStart = (workOrderId: string, hours: number) =>
  db.meterReading.updateMany({ where: { workOrderId, kind: "START" }, data: { submittedAt: new Date(Date.now() - hours * 3_600_000) } });

async function submittedJob(start = "1250.0", end = "1259.0", workDate?: string) {
  const wo = await f.newWorkOrder(f.d1.driver.id, workDate);
  await accept(wo.id);
  expect((await submit(wo.id, "START", start)).statusCode).toBe(201);
  await backdateStart(wo.id, 10);
  expect((await submit(wo.id, "END", end)).statusCode).toBe(201);
  return wo;
}

describe("authentication", () => {
  it("rejects a wrong PIN and locks the account after 5 failures", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "POST", url: "/api/auth/driver/login", payload: { loginId: "DRV-2", pin: "000000" } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({ method: "POST", url: "/api/auth/driver/login", payload: { loginId: "DRV-2", pin: "654321" } });
    expect(locked.statusCode).toBe(423);
  });

  it("does not let a non-driver account sign in to the driver app", async () => {
    await db.user.update({ where: { id: f.manager.id }, data: { loginId: "MGR-1", passwordHash: await hashSecret("111111") } });
    const r = await app.inject({ method: "POST", url: "/api/auth/driver/login", payload: { loginId: "MGR-1", pin: "111111" } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("ACCOUNT_NOT_ALLOWED");
  });

  it("requires a valid session for driver routes and revokes on logout", async () => {
    expect((await app.inject({ method: "GET", url: "/api/driver/me" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/driver/me", headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers: auth })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/driver/me", headers: auth })).statusCode).toBe(401);
  });
});

describe("driver data isolation", () => {
  it("hides other drivers' work orders and photos", async () => {
    const theirs = await f.newWorkOrder(f.d2.driver.id, "2026-10-10");
    expect((await app.inject({ method: "GET", url: `/api/driver/work-orders/${theirs.id}`, headers: auth })).statusCode).toBe(404);
    expect((await accept(theirs.id)).statusCode).toBe(404);

    const mine = await submittedJob();
    const photoUrl = (await get(mine.id)).start.photoUrl as string;
    expect((await app.inject({ method: "GET", url: photoUrl, headers: auth })).statusCode).toBe(200);
    const other = await loginAs(app, "DRV-2", "654321");
    expect((await app.inject({ method: "GET", url: photoUrl, headers: other })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: photoUrl })).statusCode).toBe(401);
  });
});

describe("work-order lifecycle", () => {
  it("runs assign → accept → start → end → pending approval", async () => {
    const wo = await f.newWorkOrder(f.d1.driver.id);
    expect((await get(wo.id)).status).toBe("ASSIGNED");
    expect((await submit(wo.id, "START", "1250")).statusCode).toBe(409); // must accept first

    expect((await accept(wo.id)).json().status).toBe("ACCEPTED");
    expect((await accept(wo.id)).statusCode).toBe(409); // cannot accept twice

    expect((await submit(wo.id, "END", "1259")).statusCode).toBe(409); // end before start
    const start = await submit(wo.id, "START", "1250");
    expect(start.statusCode).toBe(201);
    expect(start.json().workOrder.status).toBe("IN_PROGRESS");

    await backdateStart(wo.id, 10);
    const end = await submit(wo.id, "END", "1259");
    expect(end.json().workOrder).toMatchObject({ status: "PENDING_APPROVAL", operatingHours: "9.0", flags: [] });
    expect((await submit(wo.id, "END", "1260")).statusCode).toBe(409); // locked while pending
  });

  it("requires a reason to decline", async () => {
    const wo = await f.newWorkOrder(f.d1.driver.id);
    const url = `/api/driver/work-orders/${wo.id}/decline`;
    expect((await app.inject({ method: "POST", url, headers: auth, payload: { reason: "" } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url, headers: auth, payload: { reason: "Machine too far from my location" } });
    expect(ok.json()).toMatchObject({ status: "DECLINED", declineReason: "Machine too far from my location" });
  });
});

describe("meter reading validation", () => {
  it("rejects invalid values and missing or non-image photos", async () => {
    const wo = await f.newWorkOrder(f.d1.driver.id);
    await accept(wo.id);
    for (const bad of ["-5", "abc", "12.34", ""]) {
      expect((await submit(wo.id, "START", bad)).statusCode, bad).toBe(400);
    }
    expect((await submit(wo.id, "START", "1250", randomUUID(), null)).json().error.code).toBe("PHOTO_REQUIRED");
    expect((await submit(wo.id, "START", "1250", randomUUID(), Buffer.from("not an image"))).json().error.code).toBe("INVALID_PHOTO");
    expect((await get(wo.id)).status).toBe("ACCEPTED");
    expect(await db.photo.count()).toBe(0);
  });

  it("treats a retried submission as the same reading (no duplicates)", async () => {
    const wo = await f.newWorkOrder(f.d1.driver.id);
    await accept(wo.id);
    const key = randomUUID();
    expect((await submit(wo.id, "START", "1250", key)).statusCode).toBe(201);
    const retry = await submit(wo.id, "START", "1250", key);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().replayed).toBe(true);
    expect(await db.meterReading.count({ where: { workOrderId: wo.id } })).toBe(1);
    expect((await submit(wo.id, "START", "1300", key)).json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("records but flags an ending reading below the start, and blocks its approval", async () => {
    const wo = await submittedJob("1250", "1240");
    const detail = await get(wo.id);
    expect(detail.status).toBe("PENDING_APPROVAL");
    expect(detail.flags).toContain("END_BELOW_START");
    await expect(reviewSubmission(db, f.actors.manager, wo.id, { decision: "APPROVED" })).rejects.toMatchObject({ code: "NEGATIVE_HOURS" });
  });

  it("flags meter hours that exceed the clock time between start and end", async () => {
    const wo = await f.newWorkOrder(f.d1.driver.id);
    await accept(wo.id);
    await submit(wo.id, "START", "1250");
    await backdateStart(wo.id, 9);
    await submit(wo.id, "END", "1295"); // 45 h in 9 h of clock time
    expect((await get(wo.id)).flags).toEqual(expect.arrayContaining(["EXCEEDS_ELAPSED_TIME", "EXCEEDS_MAX_JOB_HOURS"]));
  });

  it("previews hours and flags without saving", async () => {
    const wo = await f.newWorkOrder(f.d1.driver.id);
    await accept(wo.id);
    await submit(wo.id, "START", "1250");
    const r = await app.inject({ method: "POST", url: `/api/driver/work-orders/${wo.id}/readings/check`, headers: auth, payload: { kind: "END", value: "1240" } });
    expect(r.json()).toEqual({ hours: "-10.0", flags: expect.arrayContaining(["END_BELOW_START"]) });
    expect(await db.meterReading.count({ where: { kind: "END" } })).toBe(0);
  });
});

describe("review, correction and approval", () => {
  it("keeps the original reading when the driver corrects a rejected one", async () => {
    const wo = await submittedJob("1250", "1295");
    await reviewSubmission(db, f.actors.manager, wo.id, { decision: "REJECTED", correctionTarget: "END", reason: "Ending digits look wrong" });
    let detail = await get(wo.id);
    expect(detail).toMatchObject({ status: "CORRECTION_REQUIRED", correctionNeeded: { start: false, end: true } });
    expect((await submit(wo.id, "START", "1251")).statusCode).toBe(409); // only END was requested

    const fix = await submit(wo.id, "END", "1259");
    expect(fix.statusCode).toBe(201);
    detail = fix.json().workOrder;
    expect(detail).toMatchObject({ status: "PENDING_APPROVAL", operatingHours: "9.0" });
    const ends = detail.readings.filter((r: { kind: string }) => r.kind === "END");
    expect(ends.map((r: { value: string; revision: number }) => [r.value, r.revision])).toEqual([["1295.0", 1], ["1259.0", 2]]);
    expect(ends[1].supersedesId).toBe(ends[0].id);
    expect(detail.flags).toEqual([]); // elapsed-time check uses the original submission times
  });

  it("waits for both readings when both were rejected", async () => {
    const wo = await submittedJob();
    await reviewSubmission(db, f.actors.manager, wo.id, { decision: "REJECTED", correctionTarget: "BOTH", reason: "Both photos are blurred" });
    expect((await submit(wo.id, "START", "1250")).json().workOrder.status).toBe("CORRECTION_REQUIRED");
    expect((await submit(wo.id, "END", "1259")).json().workOrder.status).toBe("PENDING_APPROVAL");
  });

  it("approves into the ledger once, at the rate in force on the work date", async () => {
    const before = await submittedJob("1250", "1259", "2026-10-14"); // ₹140 rate
    const after = await submittedJob("1259", "1267.5", "2026-10-16"); // ₹150 rate
    await reviewSubmission(db, f.actors.manager, before.id, { decision: "APPROVED" });
    await reviewSubmission(db, f.actors.manager, after.id, { decision: "APPROVED" });
    await expect(reviewSubmission(db, f.actors.manager, after.id, { decision: "APPROVED" })).rejects.toMatchObject({ status: 409 });

    const ledger = await db.approvedWork.findMany({ orderBy: { workDate: "asc" } });
    expect(ledger.map((l) => [l.approvedHours.toFixed(1), l.driverRate!.toFixed(2), l.driverAmount.toFixed(2)])).toEqual([
      ["9.0", "140.00", "1260.00"],
      ["8.5", "150.00", "1275.00"],
    ]);
    expect((await get(after.id)).approved).toMatchObject({ hours: "8.5", driverAmount: "1275.00" });
  });

  it("does not let drivers review, or anyone review their own submission", async () => {
    const wo = await submittedJob();
    await expect(reviewSubmission(db, { userId: f.d1.user.id, role: "DRIVER", permissions: new Set() }, wo.id, { decision: "APPROVED" })).rejects.toMatchObject({ status: 403 });
    await db.user.update({ where: { id: f.d1.user.id }, data: { role: "MANAGER" } });
    await db.userPermission.create({ data: { userId: f.d1.user.id, module: "METER_APPROVAL" } });
    await expect(reviewSubmission(db, await loadActor(db, f.d1.user.id), wo.id, { decision: "APPROVED" })).rejects.toMatchObject({ status: 403 });
  });

  it("requires a rejection reason", async () => {
    const wo = await submittedJob();
    await expect(
      reviewSubmission(db, f.actors.manager, wo.id, { decision: "REJECTED", correctionTarget: "END", reason: " " }),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });
});

describe("driver summary", () => {
  it("counts distinct dates as working days and keeps pending hours out of earnings", async () => {
    const a = await submittedJob("1000", "1004", "2026-10-16");
    const b = await submittedJob("1004", "1008.5", "2026-10-16");
    const c = await submittedJob("1008.5", "1017", "2026-10-17");
    await submittedJob("1017", "1020", "2026-10-17"); // left pending
    for (const wo of [a, b, c]) await reviewSubmission(db, f.actors.manager, wo.id, { decision: "APPROVED" });

    const s = (await app.inject({ method: "GET", url: "/api/driver/summary?month=2026-10", headers: auth })).json();
    expect(s).toMatchObject({
      approvedHours: "17.0",
      pendingHours: "3.0",
      workingDays: 2,
      approvedJobs: 3,
      approvedEarnings: "2550.00", // 17 h × ₹150
    });
  });
});
