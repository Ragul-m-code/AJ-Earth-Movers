import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { dateOnly, dateOnlyString, istDateString } from "../domain/time.js";
import { requireDriver } from "../lib/auth.js";
import { badRequest } from "../lib/errors.js";
import { getSetting } from "../lib/settings.js";
import { driverEarnings, driverMonthSummary } from "../services/driverStats.js";
import { listNotifications, markRead } from "../services/notifications.js";
import {
  checkReading,
  getDriverWorkOrder,
  LIST_GROUP_NAMES,
  listDriverWorkOrders,
  respondToAssignment,
  submitReading,
} from "../services/workOrders.js";

const idParam = z.object({ id: z.uuid() });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const meterKind = z.enum(["START", "END"]);

const actorOf = (request: FastifyRequest) => {
  const auth = requireDriver(request);
  return { userId: auth.userId, driverId: auth.driverId };
};

export const driverRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  const { db } = deps;

  app.get("/me", async (request) => {
    const actor = actorOf(request);
    const driver = await db.driver.findUniqueOrThrow({
      where: { id: actor.driverId },
      include: { compensation: { where: { effectiveFrom: { lte: dateOnly(istDateString(new Date())) } }, orderBy: { effectiveFrom: "desc" }, take: 1 } },
    });
    const comp = driver.compensation[0];
    return {
      id: driver.id,
      driverCode: driver.driverCode,
      fullName: driver.fullName,
      phone: driver.phone,
      emergencyContact: driver.emergencyContact,
      licenseNumber: driver.licenseNumber,
      licenseExpiry: driver.licenseExpiry ? dateOnlyString(driver.licenseExpiry) : null,
      joinedOn: driver.joinedOn ? dateOnlyString(driver.joinedOn) : null,
      status: driver.status,
      compensation: comp
        ? { method: comp.method, hourlyRate: comp.hourlyRate?.toFixed(2) ?? null, monthlySalary: comp.monthlySalary?.toFixed(2) ?? null, effectiveFrom: dateOnlyString(comp.effectiveFrom) }
        : null,
      today: istDateString(new Date()),
    };
  });

  app.get("/work-orders", async (request) => {
    const q = z
      .object({
        group: z.enum(LIST_GROUP_NAMES as [string, ...string[]]).optional(),
        from: ymd.optional(),
        to: ymd.optional(),
        q: z.string().max(60).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(request.query);
    return listDriverWorkOrders(db, actorOf(request), q);
  });

  app.get("/work-orders/:id", async (request) => getDriverWorkOrder(db, actorOf(request), idParam.parse(request.params).id));

  app.post("/work-orders/:id/accept", async (request) =>
    respondToAssignment(db, actorOf(request), idParam.parse(request.params).id, { accept: true }),
  );

  app.post("/work-orders/:id/decline", async (request) => {
    const { reason } = z.object({ reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500) }).parse(request.body);
    return respondToAssignment(db, actorOf(request), idParam.parse(request.params).id, { accept: false, reason });
  });

  app.post("/work-orders/:id/readings/check", async (request) => {
    const body = z.object({ kind: meterKind, value: z.string().max(12) }).parse(request.body);
    return checkReading(db, actorOf(request), idParam.parse(request.params).id, body);
  });

  // multipart/form-data: fields kind, value, idempotencyKey, note (optional) and one file field "photo".
  app.post("/work-orders/:id/readings", async (request, reply) => {
    const actor = actorOf(request);
    const { id } = idParam.parse(request.params);
    if (!request.isMultipart()) throw badRequest("MULTIPART_REQUIRED", "Send the reading as multipart/form-data with a photo.");

    const fields: Record<string, string> = {};
    let photo: Buffer | null = null;
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "photo" || photo) throw badRequest("UNEXPECTED_FILE", "Only one file named photo is allowed.");
        photo = await part.toBuffer();
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (!photo || photo.length === 0) throw badRequest("PHOTO_REQUIRED", "A meter photo is required.");

    const body = z
      .object({
        kind: meterKind,
        value: z.string().max(12),
        idempotencyKey: z.uuid(),
        note: z.string().max(500).optional(),
      })
      .parse(fields);
    const result = await submitReading(db, deps.storage, actor, id, { ...body, photo });
    return reply.status(result.replayed ? 200 : 201).send(result);
  });

  app.get("/summary", async (request) => {
    const { month } = z
      .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).default(istDateString(new Date()).slice(0, 7)) })
      .parse(request.query);
    return driverMonthSummary(db, actorOf(request), month);
  });

  app.get("/earnings", async (request) => driverEarnings(db, actorOf(request)));

  app.get("/notifications", async (request) => {
    const q = z
      .object({ unread: z.enum(["true", "false"]).default("false"), limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(request.query);
    return listNotifications(db, actorOf(request).userId, { unreadOnly: q.unread === "true", limit: q.limit });
  });

  app.post("/notifications/:id/read", async (request, reply) => {
    await markRead(db, actorOf(request).userId, idParam.parse(request.params).id);
    return reply.status(204).send();
  });

  app.post("/notifications/read-all", async (request, reply) => {
    await markRead(db, actorOf(request).userId, "all");
    return reply.status(204).send();
  });

  app.get("/support", async (request) => {
    actorOf(request);
    return {
      dispatchPhone: await getSetting(db, "contact.dispatchPhone"),
      payrollPhone: await getSetting(db, "contact.payrollPhone"),
      emergencyPhone: await getSetting(db, "contact.emergencyPhone"),
    };
  });
};
