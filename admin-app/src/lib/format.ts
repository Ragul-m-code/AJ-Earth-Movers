// All dates are shown in India Standard Time (UTC+05:30, no daylight saving).
const IST_OFFSET_MS = 330 * 60_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Indian digit grouping: 12,34,567 */
function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** "1275.5" → "₹1,275.50" */
export function rupees(amount: string | number, opts: { paise?: boolean } = {}): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  const [i, f] = Math.abs(n).toFixed(2).split(".") as [string, string];
  const showPaise = opts.paise ?? f !== "00";
  return `${n < 0 ? "−" : ""}₹${groupIndian(i)}${showPaise ? `.${f}` : ""}`;
}

/** Meter reading with grouping and one decimal: "1250" → "1,250.0" */
export function meter(value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  const [i, f] = Math.abs(n).toFixed(1).split(".") as [string, string];
  return `${n < 0 ? "−" : ""}${groupIndian(i)}.${f}`;
}

export const hours = (value: string | number) => `${Number(value).toFixed(1)} h`;

const ist = (iso: string) => new Date(new Date(iso).getTime() + IST_OFFSET_MS);

/** "2026-10-18" → "Sun, 18 Oct 2026" */
export function dateLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** ISO instant → "18 Oct, 14:05 IST" */
export function timeLabel(iso: string): string {
  const d = ist(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm} IST`;
}

export function todayIst(): string {
  return ist(new Date().toISOString()).toISOString().slice(0, 10);
}

export function relativeDay(ymd: string): string | null {
  const today = todayIst();
  const diff = Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return null;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** "₹150.00 / approved hour" or "₹24,000 / month (fixed salary)" */
export function payTerms(c: { method: "HOURLY" | "FIXED"; hourlyRate: string | null; monthlySalary: string | null }): string {
  return c.method === "HOURLY" ? `${rupees(c.hourlyRate ?? "0", { paise: true })} / approved hour` : `${rupees(c.monthlySalary ?? "0")} / month (fixed salary)`;
}

/** IST calendar date `days` from today, e.g. daysFromToday(30) for "within a month". */
export function daysFromToday(days: number): string {
  return new Date(Date.parse(`${todayIst()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
