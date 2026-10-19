import { describe, expect, it } from "vitest";
import { endReadingFlags, MeterFlag, operatingHours, startReadingFlags } from "../../src/domain/meter.js";
import { rateOn, salary, workingDays } from "../../src/domain/pay.js";
import { dateOnly, istDateString, monthRange } from "../../src/domain/time.js";
import { multiplyHoursByRate, paiseToString, parsePaise, parseTenths, tenthsToString } from "../../src/domain/units.js";
import { canTransition } from "../../src/domain/workOrderStatus.js";

const thresholds = { maxJobHours: 160, elapsedToleranceHours: 5 };
const t0 = new Date("2026-10-18T02:30:00Z"); // 08:00 IST
const hoursLater = (h: number) => new Date(t0.getTime() + h * 3_600_000);

describe("meter values", () => {
  it("parses non-negative readings with at most one decimal", () => {
    expect(parseTenths("1250")).toBe(12500);
    expect(parseTenths("1259.5")).toBe(12595);
    expect(parseTenths(" 0 ")).toBe(0);
    for (const bad of ["-1", "12.34", "abc", "", "1e3", "1,250", "12.", ".5"]) {
      expect(parseTenths(bad), bad).toBeNull();
    }
  });

  it("computes operating hours as end − start (brief example: 1250 → 1259 = 9 h)", () => {
    expect(tenthsToString(operatingHours(parseTenths("1250")!, parseTenths("1259")!))).toBe("9.0");
  });
});

describe("meter anomaly flags", () => {
  it("does not flag a normal 9-hour job", () => {
    expect(endReadingFlags({ start: 12500, end: 12590, startSubmittedAt: t0, endSubmittedAt: hoursLater(9.5), thresholds })).toEqual([]);
  });

  it("flags an ending reading lower than the start", () => {
    expect(endReadingFlags({ start: 12500, end: 12400, startSubmittedAt: t0, endSubmittedAt: hoursLater(9), thresholds }))
      .toContain(MeterFlag.END_BELOW_START);
  });

  it("flags zero hours", () => {
    expect(endReadingFlags({ start: 12500, end: 12500, startSubmittedAt: t0, endSubmittedAt: hoursLater(9), thresholds }))
      .toEqual([MeterFlag.ZERO_HOURS]);
  });

  it("flags hours above the configured job maximum", () => {
    expect(endReadingFlags({ start: 12500, end: 12500 + 170, startSubmittedAt: t0, endSubmittedAt: hoursLater(20), thresholds }))
      .toEqual([MeterFlag.EXCEEDS_MAX_JOB_HOURS]);
  });

  it("flags meter hours that exceed the clock time between submissions (typo like 1259 → 1295)", () => {
    expect(endReadingFlags({ start: 12500, end: 12950, startSubmittedAt: t0, endSubmittedAt: hoursLater(9), thresholds }))
      .toEqual([MeterFlag.EXCEEDS_MAX_JOB_HOURS, MeterFlag.EXCEEDS_ELAPSED_TIME]);
  });

  it("allows meter hours within the elapsed-time tolerance", () => {
    expect(endReadingFlags({ start: 12500, end: 12590, startSubmittedAt: t0, endSubmittedAt: hoursLater(8.6), thresholds })).toEqual([]);
  });

  it("flags a starting reading below the vehicle's last approved reading", () => {
    expect(startReadingFlags(12400, 12500)).toEqual([MeterFlag.START_BELOW_VEHICLE_HISTORY]);
    expect(startReadingFlags(12500, 12500)).toEqual([]);
    expect(startReadingFlags(12500, null)).toEqual([]);
  });
});

describe("work-order transitions", () => {
  it("allows the driver happy path", () => {
    expect(canTransition("ASSIGNED", "ACCEPTED", "driver")).toBe(true);
    expect(canTransition("ACCEPTED", "IN_PROGRESS", "driver")).toBe(true);
    expect(canTransition("IN_PROGRESS", "PENDING_APPROVAL", "driver")).toBe(true);
    expect(canTransition("CORRECTION_REQUIRED", "PENDING_APPROVAL", "driver")).toBe(true);
  });

  it("never lets a driver approve or reject", () => {
    expect(canTransition("PENDING_APPROVAL", "APPROVED", "driver")).toBe(false);
    expect(canTransition("PENDING_APPROVAL", "CORRECTION_REQUIRED", "driver")).toBe(false);
  });

  it("rejects skipping steps and leaving terminal states", () => {
    expect(canTransition("ASSIGNED", "IN_PROGRESS", "driver")).toBe(false);
    expect(canTransition("ACCEPTED", "PENDING_APPROVAL", "driver")).toBe(false);
    expect(canTransition("APPROVED", "PENDING_APPROVAL", "admin")).toBe(false);
    expect(canTransition("CANCELLED", "ASSIGNED", "admin")).toBe(false);
  });
});

describe("pay rules", () => {
  const rates = [
    { effectiveFrom: "2026-01-01", rate: 14000 },
    { effectiveFrom: "2026-10-15", rate: 15000 },
  ];

  it("picks the rate effective on the work date", () => {
    expect(rateOn(rates, "2026-10-14")?.rate).toBe(14000);
    expect(rateOn(rates, "2026-10-15")?.rate).toBe(15000);
    expect(rateOn(rates, "2025-12-31")).toBeNull();
  });

  it("counts distinct dates, not jobs, as working days", () => {
    expect(workingDays(["2026-10-01", "2026-10-01", "2026-10-02"])).toBe(2);
    expect(workingDays([])).toBe(0);
  });

  it("computes net = Σ hours × historical rate + additions − deductions", () => {
    const result = salary(
      [
        { hours: 90, rate: 14000 }, // 9.0 h @ ₹140 = ₹1,260
        { hours: 85, rate: 15000 }, // 8.5 h @ ₹150 = ₹1,275
      ],
      [50000],
      [20000],
    );
    expect(result).toEqual({ hours: 175, gross: 253500, additions: 50000, deductions: 20000, net: 283500 });
  });

  it("rounds to the nearest paisa", () => {
    expect(multiplyHoursByRate(3, 3333)).toBe(1000); // 0.3 h × ₹33.33 = ₹9.999 → ₹10.00
    expect(paiseToString(parsePaise("1275.5")!)).toBe("1275.50");
  });
});

describe("IST dates", () => {
  it("maps a UTC instant to the IST calendar date", () => {
    expect(istDateString(new Date("2026-10-17T18:29:00Z"))).toBe("2026-10-17"); // 23:59 IST
    expect(istDateString(new Date("2026-10-17T18:31:00Z"))).toBe("2026-10-18"); // 00:01 IST
  });

  it("validates dates and month ranges", () => {
    expect(() => dateOnly("2026-02-30")).toThrow();
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
});
