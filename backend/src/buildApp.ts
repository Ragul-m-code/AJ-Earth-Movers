import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { resolveSession } from "./lib/auth.js";
import { AppError } from "./lib/errors.js";
import type { PhotoStorage } from "./lib/storage.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { driverRoutes } from "./routes/driver.js";
import { photoRoutes } from "./routes/photos.js";

export interface AppDeps {
  config: Config;
  db: Db;
  storage: PhotoStorage;
}

export async function buildApp(deps: AppDeps, opts: { logger?: boolean; fastify?: typeof Fastify } = {}): Promise<FastifyInstance> {
  const app = (opts.fastify ?? Fastify)({
    logger: opts.logger === false ? false : { redact: ["req.headers.authorization", "req.body.pin", "req.body.password"] },
    trustProxy: deps.config.TRUST_PROXY ? deps.config.TRUST_PROXY === "true" : Boolean(process.env.VERCEL),
  });

  await app.register(helmet);
  // Exact origins only. Quotes, spaces and a trailing "/" (common copy-paste slips) are ignored so it still matches.
  const corsOrigins = deps.config.CORS_ORIGINS.split(",").map((o) => o.trim().replace(/^["']+|["']+$/g, "").replace(/\/+$/, "")).filter(Boolean);
  if (opts.logger !== false) app.log.info({ corsOrigins }, corsOrigins.length ? "browser origins allowed" : "no browser origins allowed (CORS_ORIGINS is empty)");
  await app.register(cors, {
    origin: corsOrigins,
    // @fastify/cors defaults to GET/HEAD/POST; the admin app also edits (PATCH/PUT) and removes (DELETE).
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: false,
    maxAge: 600,
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: deps.config.PHOTO_MAX_BYTES, files: 1, fields: 10 } });

  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (request) => {
    request.auth = await resolveSession(deps.db, request);
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "Some fields are missing or invalid.",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
    }
    const fe = err as { code?: string; statusCode?: number };
    if (fe.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.status(413).send({ error: { code: "PHOTO_TOO_LARGE", message: "The photo is too large. Retake it and try again." } });
    }
    if (fe.statusCode === 429) {
      return reply.status(429).send({ error: { code: "RATE_LIMITED", message: "Too many attempts. Wait a minute and try again." } });
    }
    if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
      return reply.status(fe.statusCode).send({ error: { code: "BAD_REQUEST", message: "The request could not be processed." } });
    }
    request.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "SERVER_ERROR", message: "Something went wrong on the server. Nothing was saved. Try again." } });
  });

  app.get("/api/health", async () => {
    await deps.db.$queryRaw`SELECT 1`;
    const photoStorageReady = deps.config.PHOTO_STORAGE !== "vercel-blob" || Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
    return { ok: true, photoStorageReady, time: new Date().toISOString() };
  });

  await app.register(authRoutes(deps), { prefix: "/api/auth" });
  await app.register(driverRoutes(deps), { prefix: "/api/driver" });
  await app.register(adminRoutes(deps), { prefix: "/api/admin" });
  await app.register(photoRoutes(deps), { prefix: "/api/photos" });
  return app;
}
