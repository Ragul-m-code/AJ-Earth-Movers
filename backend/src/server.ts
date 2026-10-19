import "./loadEnv.js";
// Vercel only accepts an entry file that imports fastify itself, so the factory is passed in from here.
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
const db = createDb();
const storage = config.PHOTO_STORAGE === "vercel-blob" ? vercelBlobPhotoStorage() : localPhotoStorage(config.PHOTO_STORAGE_DIR);
const app = await buildApp({ config, db, storage }, { fastify: Fastify });

const shutdown = async () => {
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// On Vercel, listen exactly as its Fastify integration documents (port 3000 unless PORT is given, default host),
// so the platform can route requests to the server. Locally, use the configured address.
await app.listen(process.env.VERCEL ? { port: Number(process.env.PORT) || 3000 } : { port: config.PORT, host: config.HOST });
