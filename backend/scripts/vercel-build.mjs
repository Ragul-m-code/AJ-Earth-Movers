// Vercel build step: generate the Prisma client, and apply migrations only for production deployments
// so preview builds never change the live database schema.
// Set MIGRATE_ON_BUILD=false when the build machine cannot reach the database (e.g. a database in another
// region); then run `npm run db:deploy` from a machine that can, before deploying a schema change.
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

run("npx prisma generate");
if (process.env.VERCEL_ENV !== "production") {
  console.log(`Skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`);
} else if (process.env.MIGRATE_ON_BUILD === "false") {
  console.log("Skipping migrations (MIGRATE_ON_BUILD=false). Run `npm run db:deploy` against production before deploying schema changes.");
} else {
  run("npx prisma migrate deploy");
}
