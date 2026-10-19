import { multiplyHoursByRate, type Paise, type Tenths } from "./units.js";

// Driver compensation (brief §4), kept separate from customer billing:
//   HOURLY: earnings = Σ eligible approved hours × driver rate in force on each work date
//   FIXED:  salary due = configured monthly salary for the period + authorized adjustments

export type Compensation =
  | { method: "HOURLY"; hourlyRate: Paise; effectiveFrom: string }
  | { method: "FIXED"; monthlySalary: Paise; effectiveFrom: string };

export function compensationOn(history: Compensation[], workDate: string): Compensation | null {
  let best: Compensation | null = null;
  for (const c of history) {
    if (c.effectiveFrom <= workDate && (best === null || c.effectiveFrom > best.effectiveFrom)) best = c;
  }
  return best;
}

/** Driver amount snapshotted on an approved work record. FIXED drivers earn nothing per hour. */
export function hourlyDriverAmount(comp: Compensation, hours: Tenths): { rate: Paise | null; amount: Paise } {
  return comp.method === "HOURLY" ? { rate: comp.hourlyRate, amount: multiplyHoursByRate(hours, comp.hourlyRate) } : { rate: null, amount: 0 };
}

export interface PayrollPeriod {
  start: string;
  end: string;
}

/** True when the period is exactly one calendar month (required for FIXED salary runs). */
export function isWholeMonth(p: PayrollPeriod): boolean {
  if (p.start.slice(0, 7) !== p.end.slice(0, 7) || !p.start.endsWith("-01")) return false;
  const [y, m] = p.start.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return p.end === `${p.start.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/**
 * The compensation that governs a whole period. A change of method or rate inside the period is rejected,
 * so the admin must split the period instead of the system guessing a proration.
 */
export function compensationForPeriod(history: Compensation[], p: PayrollPeriod): Compensation | { error: string } {
  const changes = history.filter((c) => c.effectiveFrom > p.start && c.effectiveFrom <= p.end);
  let atStart = compensationOn(history, p.start);
  if (!atStart) {
    // Pay terms begin inside the period (e.g. the driver joined mid-month).
    const first = [...changes].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
    if (!first) return { error: `No compensation is configured for ${p.start}–${p.end}.` };
    if (first.method === "FIXED") {
      return { error: `Fixed salary starts on ${first.effectiveFrom}, inside this month. No proration rule is configured; pay this month separately.` };
    }
    // Hourly: work before the start date cannot exist without a rate, so the period is payable as is.
    atStart = first;
    changes.splice(changes.indexOf(first), 1);
  }
  if (atStart.method === "FIXED" && changes.length > 0) {
    return { error: "The driver's salary terms change inside this period. Create separate payroll periods before and after the change." };
  }
  if (atStart.method === "HOURLY" && changes.some((c) => c.method === "FIXED")) {
    return { error: "The driver switches to a fixed salary inside this period. Split the period at the change date." };
  }
  // Hourly rate changes inside the period are fine: each work record already carries its own rate.
  return atStart;
}
