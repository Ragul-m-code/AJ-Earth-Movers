// Meter-photo storage monitoring. Photos are compressed once on the phone (1600 px JPEG) and then kept unchanged:
// they are billing and payroll evidence whose SHA-256 is on record, so they are never re-encoded later.
// Instead, usage is measured against a quota the owner sets, and owners are alerted before the store fills up.
import type { Db } from "../db.js";
import { getSetting } from "../lib/settings.js";

const GB = 1024 ** 3;
export const STORAGE_LEVELS = [
  { level: "critical", atPercent: 95 },
  { level: "warning", atPercent: 80 },
] as const;
export type StorageLevel = "ok" | (typeof STORAGE_LEVELS)[number]["level"];
const ALERT_STATE_KEY = "storage.lastAlertLevel";

export function storageLevel(percent: number): StorageLevel {
  return STORAGE_LEVELS.find((l) => percent >= l.atPercent)?.level ?? "ok";
}

export async function photoStorageUsage(db: Db) {
  const [agg, quotaGb] = await Promise.all([
    db.photo.aggregate({ _sum: { sizeBytes: true }, _count: true }),
    getSetting(db, "storage.photoQuotaGb"),
  ]);
  const usedBytes = agg._sum.sizeBytes ?? 0;
  const quotaBytes = Math.round(Number(quotaGb ?? "5") * GB);
  const percent = quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 1000) / 10 : 0;
  const days = 30;
  const recent = await db.photo.aggregate({ _sum: { sizeBytes: true }, where: { uploadedAt: { gte: new Date(Date.now() - days * 86_400_000) } } });
  const perDay = (recent._sum.sizeBytes ?? 0) / days;
  return {
    photoCount: agg._count,
    usedBytes,
    quotaBytes,
    percent,
    level: storageLevel(percent),
    // Rough forecast from the last 30 days of uploads; null when nothing was uploaded.
    daysUntilFull: perDay > 0 ? Math.max(0, Math.floor((quotaBytes - usedBytes) / perDay)) : null,
  };
}

/**
 * Called after each photo upload. Notifies every active owner once when usage first crosses 80% and again at 95%.
 * The last level alerted is remembered, so the alert repeats only after usage drops (quota raised or photos archived).
 */
export async function checkStorageAlert(db: Db) {
  const usage = await photoStorageUsage(db);
  const last = (await db.appSetting.findUnique({ where: { key: ALERT_STATE_KEY } }))?.value as StorageLevel | undefined;
  const rank = (l: StorageLevel | undefined) => (l === "critical" ? 2 : l === "warning" ? 1 : 0);
  if (rank(usage.level) === rank(last)) return usage;
  await db.$transaction(async (tx) => {
    await tx.appSetting.upsert({ where: { key: ALERT_STATE_KEY }, create: { key: ALERT_STATE_KEY, value: usage.level }, update: { value: usage.level } });
    if (rank(usage.level) > rank(last)) {
      const owners = await tx.user.findMany({ where: { role: "OWNER", status: "ACTIVE" }, select: { id: true } });
      const used = (usage.usedBytes / GB).toFixed(2);
      const quota = (usage.quotaBytes / GB).toFixed(1);
      await tx.notification.createMany({
        data: owners.map((o) => ({
          userId: o.id,
          type: "GENERAL" as const,
          title: usage.level === "critical" ? "Photo storage almost full" : "Photo storage above 80%",
          body: `Meter photos use ${used} GB of the ${quota} GB quota (${usage.percent}%). Raise the quota in Operational settings after increasing the storage plan. Photos keep uploading; nothing is deleted.`,
        })),
      });
    }
  });
  return usage;
}
