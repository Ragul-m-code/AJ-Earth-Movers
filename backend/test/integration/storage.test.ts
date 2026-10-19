// Photo storage monitoring: owners are alerted once per threshold, and uploads never fail because of it.
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db.js";
import { photoStorageUsage, storageLevel } from "../../src/services/storageUsage.js";
import { adminLogin, fixtures, loginAs, resetDb, setupTestApp, submittedViaApi } from "./helpers.js";

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

const storageAlerts = () => db.notification.count({ where: { userId: f.owner.id, title: { startsWith: "Photo storage" } } });

describe("photo storage monitoring", () => {
  it("maps usage to levels at 80% and 95%", () => {
    expect(storageLevel(10)).toBe("ok");
    expect(storageLevel(80)).toBe("warning");
    expect(storageLevel(96)).toBe("critical");
  });

  it("alerts owners once when the quota is crossed, keeps accepting photos, and shows it on the dashboard", async () => {
    const d1 = await loginAs(app, "DRV-1", "123456");
    // A tiny quota (set directly, below what the settings screen allows) so one sample photo overflows it.
    await db.appSetting.create({ data: { key: "storage.photoQuotaGb", value: "0.0000001" } });

    const wo = await f.newWorkOrder(f.d1.driver.id);
    await submittedViaApi(app, db, d1, wo.id, "100.0", "105.0");
    expect((await db.photo.count({ where: { workOrderId: wo.id } }))).toBe(2);
    expect(await storageAlerts()).toBe(1);

    const wo2 = await f.newWorkOrder(f.d1.driver.id, "2026-10-17");
    await submittedViaApi(app, db, d1, wo2.id, "105.0", "108.0");
    expect(await storageAlerts()).toBe(1);

    const usage = await photoStorageUsage(db);
    expect(usage.level).toBe("critical");
    expect(usage.photoCount).toBe(4);

    const owner = await adminLogin(app, "owner@test.local");
    const dash = await app.inject({ method: "GET", url: "/api/admin/dashboard", headers: owner });
    expect(dash.json().storage.level).toBe("critical");
    // Staff without SETTINGS do not get the storage panel.
    const accounts = await adminLogin(app, "accounts@test.local");
    expect((await app.inject({ method: "GET", url: "/api/admin/dashboard", headers: accounts })).json().storage).toBeNull();
    expect((await app.inject({ method: "GET", url: "/api/admin/settings/storage", headers: accounts })).statusCode).toBe(403);
  });
});
