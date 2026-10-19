import type { WorkOrderStatus } from "./types";

// Client-side checks give instant feedback only. The server re-validates every value and decides the flags.
export const METER_PATTERN = /^\d{1,7}(\.\d)?$/;

export function validateMeterInput(text: string): string | null {
  const t = text.trim();
  if (!t) return "Enter the reading shown on the hour meter.";
  if (t.startsWith("-")) return "A meter reading cannot be negative.";
  if (!/^[\d.]+$/.test(t)) return "Use digits only, with an optional decimal point.";
  if (!METER_PATTERN.test(t)) return "Use at most one digit after the decimal point, e.g. 1259.5.";
  return null;
}

export const FLAG_TEXT: Record<string, { title: string; help: string }> = {
  END_BELOW_START: {
    title: "Ending reading is lower than starting reading",
    help: "Hour meters only count up. Check the digits. If the meter really shows this, add a note explaining why.",
  },
  ZERO_HOURS: { title: "0 operating hours", help: "Ending and starting readings are the same. If the machine did not run, add a note." },
  EXCEEDS_MAX_JOB_HOURS: { title: "More hours than allowed for one job", help: "Check the digits carefully before submitting." },
  EXCEEDS_ELAPSED_TIME: {
    title: "More meter hours than clock time",
    help: "The meter cannot run faster than the clock since you started. A digit may be wrong.",
  },
  START_BELOW_VEHICLE_HISTORY: {
    title: "Lower than this machine's last approved reading",
    help: "The starting reading is below the last approved ending reading for this machine. Check the digits.",
  },
};

export const flagText = (code: string) => FLAG_TEXT[code] ?? { title: code, help: "An admin will review this." };

export const STATUS_META: Record<WorkOrderStatus, { label: string; tone: "info" | "success" | "warning" | "danger" | "neutral" }> = {
  ASSIGNED: { label: "New assignment", tone: "info" },
  ACCEPTED: { label: "Accepted", tone: "info" },
  IN_PROGRESS: { label: "In progress", tone: "success" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "warning" },
  CORRECTION_REQUIRED: { label: "Correction needed", tone: "danger" },
  APPROVED: { label: "Approved", tone: "success" },
  DECLINED: { label: "Declined", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};
