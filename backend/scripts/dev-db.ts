// Local PostgreSQL without Docker, for development and tests only.
// Data lives in backend/.pgdata. Credentials match .env.example. Stop with Ctrl+C.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".pgdata");
const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "aj",
  password: "aj_dev_password",
  port: 5433,
  persistent: true,
  // UTF-8 so rupee signs and Indian-language names are stored correctly (the Windows default is WIN1252).
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-c", "listen_addresses=localhost", "-c", "timezone=Asia/Kolkata"],
});

if (fresh) await pg.initialise();
await pg.start();
for (const name of ["aj_fleet", "aj_fleet_test"]) {
  await pg.createDatabase(name).catch((err: Error) => {
    if (!/already exists/.test(err.message)) throw err;
  });
}
console.log("PostgreSQL running on localhost:5433 (databases aj_fleet, aj_fleet_test). Ctrl+C to stop.");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
