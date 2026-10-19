import { describe, expect, it } from "vitest";
import {
  applyRate,
  displayStatus,
  financialYear,
  invoiceNumber,
  invoiceTotals,
  percentToBasisPoints,
  resolveAttachmentRate,
  resolveMachineRate,
  statusAfterPayment,
  workCharges,
} from "../../src/domain/billing.js";
import { compensationForPeriod, compensationOn, hourlyDriverAmount, isWholeMonth, type Compensation } from "../../src/domain/payroll.js";

const r = (effectiveFrom: string, rate: number) => ({ effectiveFrom, rate });

describe("customer machine rate resolution", () => {
  const src = {
    customerVehicle: [r("2026-10-01", 200000)],
    customerCategory: [r("2026-01-01", 185000)],
    vehicleDefault: [r("2026-01-01", 110000)],
  };
  it("prefers the customer + vehicle rate", () => {
    expect(resolveMachineRate(src, "2026-10-05")).toEqual({ rate: 200000, source: "customer:vehicle" });
  });
  it("falls back to customer category, then the vehicle default", () => {
    expect(resolveMachineRate(src, "2026-09-30")).toEqual({ rate: 185000, source: "customer:category" });
    expect(resolveMachineRate({ ...src, customerCategory: [] }, "2026-09-30")).toEqual({ rate: 110000, source: "vehicle-default" });
  });
  it("returns null when no rate exists for the date", () => {
    expect(resolveMachineRate({ customerVehicle: [], customerCategory: [], vehicleDefault: [] }, "2026-10-05")).toBeNull();
  });
  it("resolves breaker surcharges the same way", () => {
    expect(resolveAttachmentRate([], [r("2026-01-01", 45000)], "2026-10-05")).toEqual({ rate: 45000, source: "attachment-default" });
  });
});

describe("work charges", () => {
  it("bills approved hours × customer rate (brief case 7)", () => {
    expect(workCharges({ hours: 285, machineRate: 185000, breakerHours: 0, breakerRate: null })).toEqual({ machine: 5272500, breaker: 0 });
  });
  it("adds the breaker surcharge only when breaker hours were recorded (case 8)", () => {
    expect(workCharges({ hours: 285, machineRate: 185000, breakerHours: 135, breakerRate: 45000 })).toEqual({ machine: 5272500, breaker: 607500 });
    expect(workCharges({ hours: 285, machineRate: 185000, breakerHours: 0, breakerRate: 45000 }).breaker).toBe(0);
  });
  it("rejects breaker hours above the approved hours", () => {
    expect(() => workCharges({ hours: 80, machineRate: 1, breakerHours: 90, breakerRate: 1 })).toThrow();
  });
});

describe("invoice totals", () => {
  it("keeps taxable value, tax and total separate (CGST + SGST)", () => {
    const t = invoiceTotals([5272500, 607500, 650000], [2500000], { split: "INTRA_STATE", cgstBp: 900, sgstBp: 900 });
    expect(t).toEqual({ subtotal: 6530000, discountTotal: 2500000, taxableValue: 4030000, cgst: 362700, sgst: 362700, igst: 0, taxTotal: 725400, total: 4755400 });
  });
  it("supports IGST and no-tax invoices", () => {
    expect(invoiceTotals([100000], [], { split: "INTER_STATE", igstBp: 1800 }).total).toBe(118000);
    expect(invoiceTotals([100000], [], { split: "NONE" })).toMatchObject({ taxTotal: 0, total: 100000 });
  });
  it("rejects discounts larger than the subtotal", () => {
    expect(() => invoiceTotals([100], [200], { split: "NONE" })).toThrow();
  });
  it("rounds each tax half-up to the paisa", () => {
    expect(applyRate(333, 900)).toBe(30); // 29.97 → 30
    expect(percentToBasisPoints("9")).toBe(900);
    expect(percentToBasisPoints("2.5")).toBe(250);
    expect(() => percentToBasisPoints("abc")).toThrow();
  });
});

describe("invoice numbering and status", () => {
  it("numbers by Indian financial year", () => {
    expect(financialYear("2026-10-18")).toBe("2026-27");
    expect(financialYear("2027-03-31")).toBe("2026-27");
    expect(financialYear("2027-04-01")).toBe("2027-28");
    expect(invoiceNumber("AJ", "2026-10-18", 7)).toBe("AJ/2026-27/0007");
  });
  it("derives payment status and overdue", () => {
    expect(statusAfterPayment(1000, 0)).toBe("ISSUED");
    expect(statusAfterPayment(1000, 400)).toBe("PARTIALLY_PAID");
    expect(statusAfterPayment(1000, 1000)).toBe("PAID");
    expect(displayStatus("ISSUED", "2026-10-10", "2026-10-18")).toBe("OVERDUE");
    expect(displayStatus("PAID", "2026-10-10", "2026-10-18")).toBe("PAID");
    expect(displayStatus("ISSUED", "2026-10-20", "2026-10-18")).toBe("ISSUED");
  });
});

describe("driver compensation", () => {
  const history: Compensation[] = [
    { method: "HOURLY", hourlyRate: 14000, effectiveFrom: "2026-01-01" },
    { method: "HOURLY", hourlyRate: 15000, effectiveFrom: "2026-10-15" },
  ];
  it("pays hourly drivers by their own rate, not the customer's (case 9)", () => {
    expect(hourlyDriverAmount(compensationOn(history, "2026-10-16")!, 85)).toEqual({ rate: 15000, amount: 127500 });
  });
  it("gives fixed-salary drivers no per-hour amount (case 10)", () => {
    expect(hourlyDriverAmount({ method: "FIXED", monthlySalary: 2500000, effectiveFrom: "2026-01-01" }, 85)).toEqual({ rate: null, amount: 0 });
  });
  it("requires fixed salary periods without a mid-period change", () => {
    const fixed: Compensation[] = [
      { method: "FIXED", monthlySalary: 2500000, effectiveFrom: "2026-01-01" },
      { method: "FIXED", monthlySalary: 2700000, effectiveFrom: "2026-10-15" },
    ];
    expect(compensationForPeriod(fixed, { start: "2026-09-01", end: "2026-09-30" })).toMatchObject({ monthlySalary: 2500000 });
    expect(compensationForPeriod(fixed, { start: "2026-10-01", end: "2026-10-31" })).toHaveProperty("error");
    expect(compensationForPeriod(history, { start: "2026-10-01", end: "2026-10-31" })).toMatchObject({ method: "HOURLY" });
  });
  it("allows a period in which hourly pay terms begin (driver joined mid-month)", () => {
    const hourlyJoin: Compensation[] = [{ method: "HOURLY", hourlyRate: 16000, effectiveFrom: "2026-10-19" }];
    expect(compensationForPeriod(hourlyJoin, { start: "2026-10-01", end: "2026-10-31" })).toMatchObject({ method: "HOURLY", hourlyRate: 16000 });
    expect(compensationForPeriod(hourlyJoin, { start: "2026-09-01", end: "2026-09-30" })).toHaveProperty("error");
    const fixedJoin: Compensation[] = [{ method: "FIXED", monthlySalary: 2500000, effectiveFrom: "2026-10-19" }];
    expect(compensationForPeriod(fixedJoin, { start: "2026-10-01", end: "2026-10-31" })).toHaveProperty("error");
  });
  it("detects whole calendar months", () => {
    expect(isWholeMonth({ start: "2026-02-01", end: "2026-02-28" })).toBe(true);
    expect(isWholeMonth({ start: "2026-02-01", end: "2026-02-27" })).toBe(false);
    expect(isWholeMonth({ start: "2026-02-02", end: "2026-02-28" })).toBe(false);
  });
});
