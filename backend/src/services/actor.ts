import type { PermissionModule, Role } from "@prisma/client";
import type { Db } from "../db.js";
import type { AuthContext } from "../lib/auth.js";
import { forbidden } from "../lib/errors.js";
import { effectivePermissions } from "../lib/permissions.js";

/** The admin user performing an operation. Services re-check permissions themselves, not only the routes. */
export interface AdminActor {
  userId: string;
  role: Role;
  permissions: Set<PermissionModule>;
}

export const actorFromAuth = (a: AuthContext): AdminActor => ({ userId: a.userId, role: a.role, permissions: a.permissions });

/** Used by scripts and tests that act as a stored user. */
export async function loadActor(db: Db, userId: string): Promise<AdminActor> {
  const user = await db.user.findUnique({ where: { id: userId }, include: { permissions: true } });
  if (!user || user.status !== "ACTIVE") throw forbidden();
  return { userId: user.id, role: user.role, permissions: effectivePermissions(user.role, user.permissions.map((p) => p.module)) };
}

export function assertCan(actor: AdminActor, ...modules: PermissionModule[]) {
  if (actor.role === "DRIVER" || !modules.every((m) => actor.permissions.has(m))) throw forbidden();
}

/** Passes if the actor holds at least one of the modules (e.g. read-only views shared by two roles). */
export function assertCanAny(actor: AdminActor, ...modules: PermissionModule[]) {
  if (actor.role === "DRIVER" || !modules.some((m) => actor.permissions.has(m))) throw forbidden();
}
