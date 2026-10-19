import type { Db, Tx } from "../db.js";
import type { MeterThresholds } from "../domain/meter.js";
import { parseTenths } from "../domain/units.js";

/**
 * Defaults used until an authorized admin stores a value in AppSetting.
 * maxJobHours is a placeholder pending the owner's confirmation (see docs/DECISIONS_NEEDED.md).
 */
export const SETTING_DEFAULTS = {
  "meter.maxJobHours": "16",
  "meter.elapsedToleranceHours": "0.5",
  "contact.dispatchPhone": null as string | null,
  "contact.payrollPhone": null as string | null,
  "contact.emergencyPhone": "112",
  // Photo storage quota in GB; owners are alerted at 80% and 95%. Match it to the storage plan.
  "storage.photoQuotaGb": "5",
};
export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting(db: Db | Tx, key: SettingKey): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  if (row && (typeof row.value === "string" || row.value === null)) return row.value;
  return SETTING_DEFAULTS[key];
}

export async function getMeterThresholds(db: Db | Tx): Promise<MeterThresholds> {
  const max = parseTenths((await getSetting(db, "meter.maxJobHours")) ?? SETTING_DEFAULTS["meter.maxJobHours"]);
  const tol = parseTenths(
    (await getSetting(db, "meter.elapsedToleranceHours")) ?? SETTING_DEFAULTS["meter.elapsedToleranceHours"],
  );
  return { maxJobHours: max ?? 160, elapsedToleranceHours: tol ?? 5 };
}
