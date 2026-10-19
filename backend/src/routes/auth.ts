import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../buildApp.js";
import { hashSecret, login, requireAdmin, requireAuth, validateNewPassword } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { AppError } from "../lib/errors.js";
import bcrypt from "bcryptjs";

const driverLoginBody = z.object({
  loginId: z.string().trim().min(1).max(40),
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits"),
});
const adminLoginBody = z.object({
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(200),
});

export const authRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  const limit = { config: { rateLimit: { max: deps.config.LOGIN_ATTEMPTS_PER_MINUTE, timeWindow: "1 minute" } } };

  app.post("/driver/login", limit, async (request) => {
    const body = driverLoginBody.parse(request.body);
    const result = await login(deps.db, {
      identifier: body.loginId,
      secret: body.pin,
      userAgent: request.headers["user-agent"],
      ttlHours: deps.config.SESSION_TTL_HOURS,
      allowedRoles: ["DRIVER"],
    });
    return { token: result.token, user: { id: result.user.id, displayName: result.user.displayName, role: result.user.role } };
  });

  app.post("/admin/login", limit, async (request) => {
    const body = adminLoginBody.parse(request.body);
    const result = await login(deps.db, {
      identifier: body.identifier,
      secret: body.password,
      userAgent: request.headers["user-agent"],
      // Office sessions are shorter than driver sessions.
      ttlHours: Math.min(deps.config.SESSION_TTL_HOURS, 72),
      allowedRoles: ["OWNER", "MANAGER", "ACCOUNTS"],
      admin: true,
    });
    return {
      token: result.token,
      user: { id: result.user.id, displayName: result.user.displayName, role: result.user.role, mustChangePassword: result.user.mustChangePassword },
    };
  });

  app.post("/admin/change-password", limit, async (request, reply) => {
    const auth = requireAdmin(request, { allowPasswordChange: true });
    const body = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1).max(200) }).parse(request.body);
    const user = await deps.db.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      throw new AppError(400, "WRONG_PASSWORD", "Your current password is incorrect.");
    }
    if (body.currentPassword === body.newPassword) throw new AppError(400, "SAME_PASSWORD", "Choose a password different from the current one.");
    validateNewPassword(body.newPassword);
    await deps.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashSecret(body.newPassword), mustChangePassword: false } });
      // Sign out every other session for this user.
      await tx.session.updateMany({ where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, { actorId: user.id, action: "user.password_changed", entityType: "User", entityId: user.id });
    });
    return reply.status(204).send();
  });

  app.post("/logout", async (request, reply) => {
    const auth = requireAuth(request);
    await deps.db.session.update({ where: { id: auth.sessionId }, data: { revokedAt: new Date() } });
    return reply.status(204).send();
  });
};
