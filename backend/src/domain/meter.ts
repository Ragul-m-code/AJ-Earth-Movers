import type { Tenths } from "./units.js";

/**
 * Anomaly codes. A flagged reading is still recorded, never silently accepted:
 * the admin sees every flag on the review screen.
 */
export const MeterFlag = {
  END_BELOW_START: "END_BELOW_START",
  ZERO_HOURS: "ZERO_HOURS",
  EXCEEDS_MAX_JOB_HOURS: "EXCEEDS_MAX_JOB_HOURS",
  EXCEEDS_ELAPSED_TIME: "EXCEEDS_ELAPSED_TIME",
  START_BELOW_VEHICLE_HISTORY: "START_BELOW_VEHICLE_HISTORY",
} as const;
export type MeterFlag = (typeof MeterFlag)[keyof typeof MeterFlag];

export const FLAG_DESCRIPTIONS: Record<MeterFlag, string> = {
  END_BELOW_START: "Ending reading is lower than the starting reading.",
  ZERO_HOURS: "Ending reading equals the starting reading (0 operating hours).",
  EXCEEDS_MAX_JOB_HOURS: "Operating hours exceed the configured maximum for one job.",
  EXCEEDS_ELAPSED_TIME: "Operating hours exceed the clock time between the start and end submissions.",
  START_BELOW_VEHICLE_HISTORY: "Starting reading is lower than this machine's last approved ending reading.",
};

export interface MeterThresholds {
  /** Largest number of operating hours accepted for one job without a flag. */
  maxJobHours: Tenths;
  /** Extra clock time allowed when comparing meter hours against elapsed time. */
  elapsedToleranceHours: Tenths;
}

export function operatingHours(start: Tenths, end: Tenths): Tenths {
  return end - start;
}

export function startReadingFlags(start: Tenths, vehicleLastApproved: Tenths | null): MeterFlag[] {
  return vehicleLastApproved !== null && start < vehicleLastApproved
    ? [MeterFlag.START_BELOW_VEHICLE_HISTORY]
    : [];
}

export function endReadingFlags(args: {
  start: Tenths;
  end: Tenths;
  startSubmittedAt: Date;
  endSubmittedAt: Date;
  thresholds: MeterThresholds;
}): MeterFlag[] {
  const { start, end, startSubmittedAt, endSubmittedAt, thresholds } = args;
  const hours = operatingHours(start, end);
  const flags: MeterFlag[] = [];
  if (hours < 0) flags.push(MeterFlag.END_BELOW_START);
  if (hours === 0) flags.push(MeterFlag.ZERO_HOURS);
  if (hours > thresholds.maxJobHours) flags.push(MeterFlag.EXCEEDS_MAX_JOB_HOURS);

  // A machine hour meter cannot advance faster than the wall clock.
  const elapsedTenths = Math.floor((endSubmittedAt.getTime() - startSubmittedAt.getTime()) / 360_000);
  if (hours > 0 && hours > elapsedTenths + thresholds.elapsedToleranceHours) {
    flags.push(MeterFlag.EXCEEDS_ELAPSED_TIME);
  }
  return flags;
}
