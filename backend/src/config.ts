import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGINS: z.string().default(""),
  // "local" writes to PHOTO_STORAGE_DIR; "vercel-blob" uses a private Vercel Blob store (required on Vercel).
  PHOTO_STORAGE: z.enum(["local", "vercel-blob"]).default("local"),
  PHOTO_STORAGE_DIR: z.string().default("./storage/photos"),
  // Vercel rejects request bodies over 4.5 MB, so the default stays under that.
  PHOTO_MAX_BYTES: z.coerce.number().int().positive().default(4 * 1024 * 1024),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(336),
  LOGIN_ATTEMPTS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  NODE_ENV: z.string().default("development"),
  // Trust X-Forwarded-For only behind a proxy that overwrites it (Vercel does). Otherwise clients could
  // spoof their IP and dodge the per-IP sign-in limit. Defaults to on when running on Vercel.
  TRUST_PROXY: z.enum(["true", "false"]).optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${missing}`);
  }
  return parsed.data;
}
