import "./loadEnv.js";
// Vercel only accepts an entry file that imports fastify itself, so the factory is passed in from here.
import type { IncomingMessage, ServerResponse } from "node:http";
import Fastify from "fastify";
import { buildApp } from "./buildApp.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { localPhotoStorage, vercelBlobPhotoStorage } from "./lib/storage.js";

// Vercel runs this file as a Fastify function (zero-config entry: src/server.ts).
const config = loadConfig();
if (process.env.VERCEL && config.PHOTO_STORAGE !== "vercel-blob") {
  throw new Error("PHOTO_STORAGE must be 'vercel-blob' on Vercel: the function disk is not persistent.");
}
if (config.PHOTO_STORAGE === "vercel-blob" && !process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
  // Don't refuse to start (sign-in and approvals still work), but make the cause obvious in the logs.
  console.error("PHOTO STORAGE NOT CONNECTED: no BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID. Meter photo uploads will fail. Connect a private Vercel Blob store to this project.");
}
const db = createDb();
const storage = config.PHOTO_STORAGE === "vercel-blob" ? vercelBlobPhotoStorage() : localPhotoStorage(config.PHOTO_STORAGE_DIR);
const app = await buildApp({ config, db, storage }, { fastify: Fastify });

/**
 * Vercel entry: Vercel calls this for every request. The app is built once per instance
 * (module scope) and reused while the instance stays warm.
 */
const ready = app.ready();
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ready;
  app.server.emit("request", req, res);
}

if (!process.env.VERCEL) {
  const shutdown = async () => {
    await app.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await app.listen({ port: config.PORT, host: config.HOST });
}
