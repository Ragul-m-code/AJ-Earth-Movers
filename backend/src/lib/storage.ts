import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { del, get, put } from "@vercel/blob";

/**
 * Private photo storage. Photos are never publicly addressable: they are only
 * returned through the authorized /api/photos route.
 */
export interface PhotoStorage {
  put(bytes: Buffer, ext: string): Promise<{ key: string; sha256: string }>;
  read(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
}

const newKey = (ext: string) => {
  const now = new Date();
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
};
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Local disk, for development and single-server hosting. */
export function localPhotoStorage(rootDir: string): PhotoStorage {
  const root = path.resolve(rootDir);
  const resolveKey = (key: string) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  };
  return {
    async put(bytes, ext) {
      const key = newKey(ext);
      const full = resolveKey(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes, { flag: "wx" });
      return { key, sha256: sha256(bytes) };
    },
    read: async (key) => createReadStream(resolveKey(key)),
    remove: (key) => rm(resolveKey(key), { force: true }),
  };
}

/**
 * A private Vercel Blob store, for serverless hosting where the disk is not persistent.
 * Credentials come from the connected store (OIDC on Vercel) or BLOB_READ_WRITE_TOKEN.
 */
export function vercelBlobPhotoStorage(prefix = "meter-photos"): PhotoStorage {
  const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };
  return {
    async put(bytes, ext) {
      const key = `${prefix}/${newKey(ext)}`;
      await put(key, bytes, { access: "private", contentType: MIME[ext], addRandomSuffix: false, allowOverwrite: false });
      return { key, sha256: sha256(bytes) };
    },
    async read(key) {
      const result = await get(key, { access: "private", useCache: false });
      if (!result || result.statusCode !== 200) throw new Error(`Photo ${key} is missing from storage`);
      return Readable.fromWeb(result.stream as NodeReadableStream<Uint8Array>);
    },
    remove: (key) => del(key),
  };
}

/** Detects JPEG/PNG/WebP/HEIC from magic bytes; the client-supplied MIME type is not trusted. */
export function sniffImageType(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png" };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp" && /^(heic|heix|mif1|msf1)$/.test(bytes.toString("ascii", 8, 12))) {
    return { mime: "image/heic", ext: "heic" };
  }
  return null;
}
