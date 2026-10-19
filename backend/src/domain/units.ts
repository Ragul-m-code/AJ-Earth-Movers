// Integer-unit arithmetic. Hours are handled as tenths (0.1 h) and money as paise,
// so no calculation in the business rules goes through binary floating point.

export type Tenths = number;
export type Paise = number;

const METER_PATTERN = /^\d{1,7}(\.\d)?$/;

/** Parses a meter or hour value with at most one decimal place. Returns null if invalid. */
export function parseTenths(input: string | number): Tenths | null {
  const text = typeof input === "number" ? String(input) : input.trim();
  if (!METER_PATTERN.test(text)) return null;
  const [whole, frac = "0"] = text.split(".");
  return Number(whole) * 10 + Number(frac);
}

export function tenthsToString(t: Tenths): string {
  const sign = t < 0 ? "-" : "";
  const abs = Math.abs(t);
  return `${sign}${Math.floor(abs / 10)}.${abs % 10}`;
}

const MONEY_PATTERN = /^-?\d{1,10}(\.\d{1,2})?$/;

export function parsePaise(input: string | number): Paise | null {
  const text = typeof input === "number" ? input.toFixed(2) : input.trim();
  if (!MONEY_PATTERN.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, frac = ""] = text.replace("-", "").split(".");
  const value = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return negative ? -value : value;
}

export function paiseToString(p: Paise): string {
  const sign = p < 0 ? "-" : "";
  const abs = Math.abs(p);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** hours (tenths) × hourly rate (paise) → paise, rounded half-up to the nearest paisa. */
export function multiplyHoursByRate(hours: Tenths, ratePerHour: Paise): Paise {
  const raw = hours * ratePerHour; // tenth-paise
  const sign = raw < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(raw) + 5) / 10);
}
