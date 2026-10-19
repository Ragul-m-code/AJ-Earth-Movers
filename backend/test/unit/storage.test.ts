import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({ store: new Map<string, { bytes: Buffer; opts: Record<string, unknown> }>() }));
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (key: string, bytes: Buffer, opts: Record<string, unknown>) => {
    if (blob.store.has(key)) throw new Error("exists");
    blob.store.set(key, { bytes, opts });
    return { pathname: key };
  }),
  get: vi.fn(async (key: string) => {
    const hit = blob.store.get(key);
    if (!hit) return null;
    return { statusCode: 200, stream: new Blob([new Uint8Array(hit.bytes)]).stream(), blob: { contentType: hit.opts.contentType } };
  }),
  del: vi.fn(async (key: string) => void blob.store.delete(key)),
}));

const { localPhotoStorage, vercelBlobPhotoStorage } = await import("../../src/lib/storage.js");

describe("photo storage", () => {
  beforeEach(() => blob.store.clear());

  it("vercel blob: stores privately, reads back, and deletes", async () => {
    const s = vercelBlobPhotoStorage();
    const { key, sha256 } = await s.put(Buffer.from("meter-photo"), "jpg");
    expect(key).toMatch(/^meter-photos\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    expect(sha256).toHaveLength(64);
    expect(blob.store.get(key)!.opts).toMatchObject({ access: "private", contentType: "image/jpeg", allowOverwrite: false });
    expect(await text(await s.read(key))).toBe("meter-photo");
    await s.remove(key);
    await expect(s.read(key)).rejects.toThrow(/missing/);
  });

  it("local: round-trips and refuses keys outside its directory", async () => {
    const s = localPhotoStorage(mkdtempSync(path.join(tmpdir(), "aj-unit-")));
    const { key } = await s.put(Buffer.from("abc"), "png");
    expect(await text(await s.read(key))).toBe("abc");
    await expect(s.read("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
  });
});
