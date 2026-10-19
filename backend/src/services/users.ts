// Admin users, roles and per-module permissions. Only the owner manages users.
import { Prisma, type PermissionModule, type Role } from "@prisma/client";
import type { Db } from "../db.js";
import { audit } from "../lib/audit.js";
import { hashSecret, temporaryPassword } from "../lib/auth.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { ALL_MODULES, DEFAULT_PERMISSIONS, effectivePermissions } from "../lib/permissions.js";
import { type AdminActor, assertCan } from "./actor.js";

type AdminRole = Exclude<Role, "DRIVER">;

export async function listAdminUsers(db: Db, actor: AdminActor) {
  assertCan(actor, "USERS");
  const users = await db.user.findMany({
    where: { role: { not: "DRIVER" } },
    include: { permissions: true, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, take: 1 } },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
  });
  return users.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    lastSeenAt: u.sessions[0]?.lastSeenAt.toISOString() ?? null,
    permissions: [...effectivePermissions(u.role, u.permissions.map((p) => p.module))],
    isSelf: u.id === actor.userId,
  }));
}

function checkPermissions(role: AdminRole, modules: PermissionModule[] | undefined) {
  if (role === "OWNER") return [];
  const list = modules ?? DEFAULT_PERMISSIONS[role];
  const bad = list.filter((m) => !ALL_MODULES.includes(m) || m === "USERS");
  if (bad.length) throw badRequest("INVALID_PERMISSION", `Only the owner can manage users. Remove: ${bad.join(", ")}.`);
  return [...new Set(list)];
}

/** Creates an admin user with a one-time temporary password the owner hands over in person. */
export async function createAdminUser(db: Db, actor: AdminActor, input: { displayName: string; email: string; phone?: string; role: AdminRole; permissions?: PermissionModule[] }) {
  assertCan(actor, "USERS");
  if (actor.role !== "OWNER") throw forbidden();
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw badRequest("INVALID_EMAIL", "Enter a valid email address.");
  if (input.displayName.trim().length < 2) throw badRequest("NAME_REQUIRED", "Enter the person's name.");
  const modules = checkPermissions(input.role, input.permissions);
  const password = temporaryPassword();
  const hash = await hashSecret(password);
  try {
    const user = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { loginId: email, email, phone: input.phone?.replace(/\s/g, "") || null, displayName: input.displayName.trim(), role: input.role, passwordHash: hash, mustChangePassword: true },
      });
      if (modules.length) await tx.userPermission.createMany({ data: modules.map((module) => ({ userId: u.id, module, grantedById: actor.userId })) });
      await audit(tx, { actorId: actor.userId, action: "user.created", entityType: "User", entityId: u.id, after: { email, role: input.role, permissions: modules } });
      return u;
    });
    return { userId: user.id, temporaryPassword: password };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict("EMAIL_TAKEN", "A user with this email already exists.");
    throw err;
  }
}

export async function updateAdminUser(db: Db, actor: AdminActor, userId: string, input: { role?: AdminRole; permissions?: PermissionModule[]; displayName?: string; phone?: string | null }) {
  assertCan(actor, "USERS");
  if (actor.role !== "OWNER") throw forbidden();
  const user = await db.user.findUnique({ where: { id: userId }, include: { permissions: true } });
  if (!user || user.role === "DRIVER") throw notFound("User");
  const role = input.role ?? (user.role as AdminRole);
  if (user.id === actor.userId && role !== "OWNER") throw conflict("LAST_OWNER", "You cannot remove your own owner role.");
  const modules = input.permissions || input.role ? checkPermissions(role, input.permissions ?? (user.permissions.map((p) => p.module) as PermissionModule[])) : null;
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role, displayName: input.displayName?.trim(), phone: input.phone === undefined ? undefined : input.phone?.replace(/\s/g, "") || null } });
    if (modules) {
      await tx.userPermission.deleteMany({ where: { userId } });
      if (modules.length) await tx.userPermission.createMany({ data: modules.map((module) => ({ userId, module, grantedById: actor.userId })) });
    }
    await audit(tx, {
      actorId: actor.userId,
      action: "user.permissions_changed",
      entityType: "User",
      entityId: userId,
      before: { role: user.role, permissions: user.permissions.map((p) => p.module) },
      after: { role, permissions: modules ?? undefined },
    });
  });
}

export async function setAdminUserStatus(db: Db, actor: AdminActor, userId: string, active: boolean, reason: string) {
  assertCan(actor, "USERS");
  if (actor.role !== "OWNER") throw forbidden();
  if (userId === actor.userId) throw conflict("SELF", "You cannot deactivate your own account.");
  if (reason.trim().length < 3) throw badRequest("REASON_REQUIRED", "Give a short reason.");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.role === "DRIVER") throw notFound("User");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status: active ? "ACTIVE" : "DISABLED" } });
    if (!active) await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: active ? "user.reactivated" : "user.deactivated", entityType: "User", entityId: userId, reason: reason.trim() });
  });
}

export async function resetAdminPassword(db: Db, actor: AdminActor, userId: string) {
  assertCan(actor, "USERS");
  if (actor.role !== "OWNER") throw forbidden();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.role === "DRIVER") throw notFound("User");
  const password = temporaryPassword();
  const hash = await hashSecret(password);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: hash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: "user.password_reset", entityType: "User", entityId: userId });
  });
  return { temporaryPassword: password };
}
