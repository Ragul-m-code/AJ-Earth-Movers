// India Standard Time is a fixed UTC+05:30 offset with no daylight saving.
export const BUSINESS_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Calendar date in IST as YYYY-MM-DD. */
export function istDateString(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Converts a YYYY-MM-DD string into the Date Prisma expects for a @db.Date column. */
export function dateOnly(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Invalid date: ${ymd}`);
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd) {
    throw new Error(`Invalid date: ${ymd}`);
  }
  return d;
}

/** Reads a @db.Date value back as YYYY-MM-DD. */
export function dateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** First and last calendar day of a YYYY-MM month. */
export function monthRange(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`Invalid month: ${month}`);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}
