import { existsSync } from "node:fs";

// Node 22 reads .env natively; real deployments set variables in the environment instead.
if (existsSync(".env")) process.loadEnvFile(".env");
process.env.TZ ??= "Asia/Kolkata";
