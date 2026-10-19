// Wipes all business data but keeps every OWNER account (and their sign-in sessions), e.g. after go-live testing.
//   npx tsx scripts/reset-keep-owner.ts                 -> dry run: shows the target database and what would be deleted
//   npx tsx scripts/reset-keep-owner.ts --confirm "DELETE ALL DATA"
// Deletes: drivers, staff (non-owner) users, customers, fleet, work orders, readings, photos, invoices, payments,
// payroll, expenses, notifications, settings and the audit log. The schema and migrations are untouched.
// Meter photos in a private Vercel Blob store are deleted too when BLOB_READ_WRITE_TOKEN is set.
import "../src/loadEnv.js";
import { parseArgs } from "node:util";
import { del, list } from "@vercel/blob";
import { createDb } from "../src/db.js";

const { values } = parseArgs({ options: { confirm: { type: "string" } } });
const db = createDb();
const host = new URL(process.env.DATABASE_URL ?? "postgresql://unset").hostname;

const KEEP = new Set(["_prisma_migrations", "User", "Session"]);
const tables = (await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)
  .map((t) => t.tablename)
  .filter((t) => !KEEP.has(t));
const owners = await db.user.findMany({ where: { role: "OWNER" }, select: { email: true, status: true } });
const others = await db.user.count({ where: { role: { not: "OWNER" } } });
const photos = await db.photo.count();

console.log(`Database: ${host}`);
console.log(`Owners kept (${owners.length}): ${owners.map((o) => `${o.email} [${o.status}]`).join(", ") || "none"}`);
console.log(`Other users to delete: ${others} · photo records: ${photos} · tables cleared: ${tables.length}`);

if (owners.filter((o) => o.status === "ACTIVE").length === 0) {
  console.error("Refusing: no active owner would remain, so nobody could sign in afterwards.");
  process.exit(1);
}
if (values.confirm !== "DELETE ALL DATA") {
  console.log('\nDry run only. To delete, re-run with:  --confirm "DELETE ALL DATA"');
  await db.$disconnect();
  process.exit(0);
}

await db.$transaction(async (tx) => {
  // One TRUNCATE without CASCADE: if any kept table referenced a cleared one, Postgres refuses instead of deleting it.
  await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY`);
  await tx.session.deleteMany({ where: { user: { role: { not: "OWNER" } } } });
  await tx.user.deleteMany({ where: { role: { not: "OWNER" } } });
  await tx.user.updateMany({ where: { role: "OWNER" }, data: { failedLoginCount: 0, lockedUntil: null } });
  await tx.auditLog.create({ data: { actorId: null, action: "data.reset_keep_owner", entityType: "System", entityId: "all", after: { tablesCleared: tables.length, usersDeleted: others } } });
});
console.log("Database cleared. Owner accounts kept.");

if (process.env.BLOB_READ_WRITE_TOKEN) {
  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "meter-photos/", cursor, limit: 1000 });
    if (page.blobs.length) await del(page.blobs.map((b) => b.url));
    removed += page.blobs.length;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  console.log(`Deleted ${removed} meter photo file(s) from the Blob store.`);
} else if (photos > 0) {
  console.log("Photo files were not removed: set BLOB_READ_WRITE_TOKEN to also clear them from the Blob store (or delete the meter-photos/ folder in Vercel Storage).");
}
await db.$disconnect();
