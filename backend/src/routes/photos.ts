import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { can, requireAdmin, requireAuth } from "../lib/auth.js";
import { notFound } from "../lib/errors.js";

export const photoRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  app.get("/:id", async (request, reply) => {
    const auth = requireAuth(request);
    // Office users on a temporary password may only change it.
    if (auth.driverId === null) requireAdmin(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const photo = await deps.db.photo.findUnique({ where: { id }, include: { workOrder: { select: { driverId: true } } } });
    const allowed =
      photo &&
      (auth.driverId !== null ? photo.workOrder.driverId === auth.driverId : can(auth, "METER_APPROVAL") || can(auth, "WORK_ORDERS"));
    if (!photo || !allowed) throw notFound("Photo");
    return reply
      .header("Content-Type", photo.mimeType)
      .header("Cache-Control", "private, no-store")
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .send(await deps.storage.read(photo.storageKey));
  });
};
