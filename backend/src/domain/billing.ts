import { rateOn, type EffectiveRate } from "./pay.js";
import { multiplyHoursByRate, type Paise, type Tenths } from "./units.js";

// Customer billing rules (brief §4):
//   Base machine charge = approved hours × applicable customer machine rate
//   Breaker charge      = approved breaker hours × applicable breaker surcharge (only when a breaker was used)
//   Subtotal            = machine + breaker + other authorized items
//   Taxable value       = subtotal − authorized discounts
//   Invoice total       = taxable value + verified taxes

export interface MachineRateSources {
  customerVehicle: EffectiveRate[];
  customerCategory: EffectiveRate[];
  vehicleDefault: EffectiveRate[];
}

export type RateSource = "customer:vehicle" | "customer:category" | "vehicle-default" | "customer:attachment" | "attachment-default";

/** Most specific rate wins: customer + vehicle, then customer + category, then the machine's default. */
export function resolveMachineRate(src: MachineRateSources, workDate: string): { rate: Paise; source: RateSource } | null {
  const order: [EffectiveRate[], RateSource][] = [
    [src.customerVehicle, "customer:vehicle"],
    [src.customerCategory, "customer:category"],
    [src.vehicleDefault, "vehicle-default"],
  ];
  for (const [rates, source] of order) {
    const r = rateOn(rates, workDate);
    if (r) return { rate: r.rate, source };
  }
  return null;
}

export function resolveAttachmentRate(customer: EffectiveRate[], fallback: EffectiveRate[], workDate: string): { rate: Paise; source: RateSource } | null {
  const c = rateOn(customer, workDate);
  if (c) return { rate: c.rate, source: "customer:attachment" };
  const d = rateOn(fallback, workDate);
  return d ? { rate: d.rate, source: "attachment-default" } : null;
}

export interface WorkCharge {
  hours: Tenths;
  machineRate: Paise;
  breakerHours: Tenths;
  breakerRate: Paise | null;
}

export function workCharges(w: WorkCharge): { machine: Paise; breaker: Paise } {
  if (w.breakerHours < 0 || w.breakerHours > w.hours) throw new Error("Breaker hours must be between 0 and the approved hours");
  if (w.breakerHours > 0 && w.breakerRate === null) throw new Error("Breaker hours need a breaker rate");
  return {
    machine: multiplyHoursByRate(w.hours, w.machineRate),
    // No breaker usage recorded means no breaker charge, whatever attachments were assigned.
    breaker: w.breakerHours > 0 ? multiplyHoursByRate(w.breakerHours, w.breakerRate!) : 0,
  };
}

/** Percentage like "9.00" → basis points (900), so tax maths stays in integers. */
export function percentToBasisPoints(pct: string): number {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(pct)) throw new Error(`Invalid tax rate: ${pct}`);
  const [w, f = ""] = pct.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

/** amount × rate, rounded half-up to the paisa. */
export function applyRate(amount: Paise, basisPoints: number): Paise {
  return Math.floor((amount * basisPoints + 5000) / 10000);
}

export type TaxInput =
  | { split: "NONE" }
  | { split: "INTRA_STATE"; cgstBp: number; sgstBp: number }
  | { split: "INTER_STATE"; igstBp: number };

export interface InvoiceTotals {
  subtotal: Paise;
  discountTotal: Paise;
  taxableValue: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  taxTotal: Paise;
  total: Paise;
}

export function invoiceTotals(charges: Paise[], discounts: Paise[], tax: TaxInput): InvoiceTotals {
  if (charges.some((c) => c < 0) || discounts.some((d) => d < 0)) throw new Error("Charges and discounts must be non-negative");
  const subtotal = charges.reduce((s, c) => s + c, 0);
  const discountTotal = discounts.reduce((s, d) => s + d, 0);
  if (discountTotal > subtotal) throw new Error("Discounts cannot exceed the subtotal");
  const taxableValue = subtotal - discountTotal;
  // Each tax component is computed on the taxable value and rounded on its own.
  const cgst = tax.split === "INTRA_STATE" ? applyRate(taxableValue, tax.cgstBp) : 0;
  const sgst = tax.split === "INTRA_STATE" ? applyRate(taxableValue, tax.sgstBp) : 0;
  const igst = tax.split === "INTER_STATE" ? applyRate(taxableValue, tax.igstBp) : 0;
  const taxTotal = cgst + sgst + igst;
  return { subtotal, discountTotal, taxableValue, cgst, sgst, igst, taxTotal, total: taxableValue + taxTotal };
}

/** Indian financial year label for a date: April–March, e.g. 2026-10-18 → "2026-27". */
export function financialYear(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function invoiceNumber(prefix: string, ymd: string, seq: number): string {
  return `${prefix}/${financialYear(ymd)}/${String(seq).padStart(4, "0")}`;
}

export type StoredInvoiceStatus = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

/** Status after payments: overpayment is rejected by the caller, so paid ≤ total always holds. */
export function statusAfterPayment(total: Paise, paid: Paise): "ISSUED" | "PARTIALLY_PAID" | "PAID" {
  if (paid <= 0) return "ISSUED";
  return paid >= total ? "PAID" : "PARTIALLY_PAID";
}

/** OVERDUE is shown, never stored: an unpaid or part-paid invoice past its due date. */
export function displayStatus(status: StoredInvoiceStatus, dueDate: string | null, today: string): StoredInvoiceStatus | "OVERDUE" {
  return (status === "ISSUED" || status === "PARTIALLY_PAID") && dueDate !== null && dueDate < today ? "OVERDUE" : status;
}
