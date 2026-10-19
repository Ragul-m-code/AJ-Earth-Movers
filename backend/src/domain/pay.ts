import { multiplyHoursByRate, type Paise, type Tenths } from "./units.js";

export interface EffectiveRate {
  effectiveFrom: string; // YYYY-MM-DD
  rate: Paise;
}

/** The rate in force on workDate: the latest one whose effectiveFrom is on or before it. */
export function rateOn(rates: EffectiveRate[], workDate: string): EffectiveRate | null {
  let best: EffectiveRate | null = null;
  for (const r of rates) {
    if (r.effectiveFrom <= workDate && (best === null || r.effectiveFrom > best.effectiveFrom)) best = r;
  }
  return best;
}

/** Working days = distinct calendar dates with qualifying approved work, not the number of jobs. */
export function workingDays(workDates: string[]): number {
  return new Set(workDates).size;
}

export interface PayLine {
  hours: Tenths;
  rate: Paise;
}

export interface SalaryBreakdown {
  hours: Tenths;
  gross: Paise;
  additions: Paise;
  deductions: Paise;
  net: Paise;
}

/**
 * Net payable = Σ(approved hours × rate applicable on that work date) + authorized additions − authorized deductions.
 * Each line keeps its own historical rate, so a rate change never re-prices earlier work.
 */
export function salary(lines: PayLine[], additions: Paise[], deductions: Paise[]): SalaryBreakdown {
  const hours = lines.reduce((s, l) => s + l.hours, 0);
  const gross = lines.reduce((s, l) => s + multiplyHoursByRate(l.hours, l.rate), 0);
  const add = additions.reduce((s, a) => s + a, 0);
  const ded = deductions.reduce((s, d) => s + d, 0);
  return { hours, gross, additions: add, deductions: ded, net: gross + add - ded };
}
