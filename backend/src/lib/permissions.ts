import type { PermissionModule, Role } from "@prisma/client";

export const ALL_MODULES: PermissionModule[] = [
  "DASHBOARD",
  "WORK_ORDERS",
  "METER_APPROVAL",
  "METER_CORRECTION",
  "FLEET",
  "MAINTENANCE",
  "CUSTOMERS",
  "RATES",
  "INVOICES",
  "PAYMENTS",
  "DRIVERS",
  "PAYROLL",
  "EXPENSES",
  "REPORTS",
  "USERS",
  "SETTINGS",
  "TAX_VERIFY",
];

/**
 * Starting permissions when an admin user is created. The owner can change them per user.
 * Based on the RBAC matrix in the Stitch admin IA screen (owner / fleet manager / accounts).
 */
export const DEFAULT_PERMISSIONS: Record<Exclude<Role, "OWNER" | "DRIVER">, PermissionModule[]> = {
  MANAGER: ["DASHBOARD", "WORK_ORDERS", "METER_APPROVAL", "FLEET", "MAINTENANCE", "CUSTOMERS", "DRIVERS", "EXPENSES", "REPORTS"],
  ACCOUNTS: ["DASHBOARD", "WORK_ORDERS", "METER_APPROVAL", "CUSTOMERS", "RATES", "INVOICES", "PAYMENTS", "PAYROLL", "EXPENSES", "REPORTS"],
};

/** Modules only an owner may hold, whatever is stored. */
const OWNER_ONLY: PermissionModule[] = ["USERS"];

export function effectivePermissions(role: Role, granted: PermissionModule[]): Set<PermissionModule> {
  if (role === "OWNER") return new Set(ALL_MODULES);
  if (role === "DRIVER") return new Set();
  return new Set(granted.filter((m) => !OWNER_ONLY.includes(m)));
}
