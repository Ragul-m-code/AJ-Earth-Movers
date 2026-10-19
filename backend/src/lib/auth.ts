import { createHash, randomBytes, randomInt } from "node:crypto";
import type { PermissionModule, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { FastifyRequest } from "fastify";
import type { Db } from "../db.js";
import { AppError, badRequest, forbidden, unauthorized } from "./errors.js";
import { effectivePermissions } from "./permissions.js";

export interface AuthContext {
  sessionId: string;
  userId: string;
  role: Role;
  /** Set only for DRIVER accounts. */
  driverId: string | null;
  permissions: Set<PermissionModule>;
  mustChangePassword: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const BCRYPT_ROUNDS = 12;
export const MIN_PASSWORD_LENGTH = 10;

export const hashSecret = (secret: string) => bcrypt.hash(secret, BCRYPT_ROUNDS);
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Compared against when the login id does not exist, so response time does not reveal valid ids.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-secret", BCRYPT_ROUNDS);

export function validateNewPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) throw badRequest("WEAK_PASSWORD", `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throw badRequest("WEAK_PASSWORD", "Use both letters and numbers.");
}

/** Random temporary password shown once to the owner, e.g. "Kp7m-Qx3r-Tz9w". The user must change it at first sign-in. */
export function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const part = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${part()}-${part()}-${part()}`;
}

export async function login(
  db: Db,
  args: { identifier: string; secret: string; userAgent?: string; ttlHours: number; allowedRoles: Role[]; admin?: boolean },
) {
  const invalid = new AppError(401, "INVALID_CREDENTIALS", args.admin ? "Email/phone or password is incorrect." : "Driver ID or PIN is incorrect.");
  const id = args.identifier.trim();
  const user = args.admin
    ? ((await db.user.findUnique({ where: { loginId: id.toLowerCase() }, include: { driver: true } })) ??
      (await db.user.findFirst({ where: { phone: id.replace(/\s/g, ""), role: { not: "DRIVER" } }, include: { driver: true } })))
    : await db.user.findUnique({ where: { loginId: id.toUpperCase() }, include: { driver: true } });

  if (!user) {
    await bcrypt.compare(args.secret, DUMMY_HASH);
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, "ACCOUNT_LOCKED", `Too many failed attempts. Try again after ${LOCK_MINUTES} minutes.`);
  }
  const ok = await bcrypt.compare(args.secret, user.passwordHash);
  if (!ok) {
    // Atomic increment, so parallel guesses cannot all slip in under the limit.
    const { failedLoginCount } = await db.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true } });
    if (failedLoginCount >= MAX_FAILED_LOGINS) {
      await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } });
    }
    throw invalid;
  }
  if (user.status !== "ACTIVE" || !args.allowedRoles.includes(user.role) || (user.role === "DRIVER" && user.driver?.status === "INACTIVE")) {
    throw new AppError(403, "ACCOUNT_NOT_ALLOWED", "This account cannot sign in to this app.");
  }

  const token = randomBytes(32).toString("base64url");
  const session = await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId: user.id,
      userAgent: args.userAgent?.slice(0, 200),
      expiresAt: new Date(Date.now() + args.ttlHours * 3_600_000),
    },
  });
  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  return { token, sessionId: session.id, user };
}

export async function resolveSession(db: Db, request: FastifyRequest): Promise<AuthContext | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(header.slice(7)) },
    include: { user: { include: { driver: true, permissions: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") return null;
  // Deactivation revokes sessions too; this also covers a driver deactivated by any other path.
  if (session.user.role === "DRIVER" && (!session.user.driver || session.user.driver.status === "INACTIVE")) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return {
    sessionId: session.id,
    userId: session.userId,
    role: session.user.role,
    driverId: session.user.driver?.id ?? null,
    permissions: effectivePermissions(session.user.role, session.user.permissions.map((p) => p.module)),
    mustChangePassword: session.user.mustChangePassword,
  };
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

export function requireDriver(request: FastifyRequest): AuthContext & { driverId: string } {
  const auth = requireAuth(request);
  if (auth.role !== "DRIVER" || !auth.driverId) throw forbidden();
  return auth as AuthContext & { driverId: string };
}

/** Any admin-app user. A user holding a temporary password can only change it. */
export function requireAdmin(request: FastifyRequest, opts: { allowPasswordChange?: boolean } = {}): AuthContext {
  const auth = requireAuth(request);
  if (auth.role === "DRIVER") throw forbidden();
  if (auth.mustChangePassword && !opts.allowPasswordChange) {
    throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Set a new password before continuing.");
  }
  return auth;
}

export function requirePermission(request: FastifyRequest, ...modules: PermissionModule[]): AuthContext {
  const auth = requireAdmin(request);
  if (!modules.every((m) => auth.permissions.has(m))) throw forbidden();
  return auth;
}

export const can = (auth: AuthContext, module: PermissionModule) => auth.permissions.has(module);
