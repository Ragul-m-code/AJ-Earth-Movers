// Creates the first OWNER account for a real installation.
//   npm run create-owner -- --email owner@yourcompany.in --name "Full Name" [--phone 9876543210]
// A one-time temporary password is printed once. The owner must change it at first sign-in.
// Refuses to run if an active owner already exists (pass --additional to add a second owner deliberately).
import "../src/loadEnv.js";
import { parseArgs } from "node:util";
import { createDb } from "../src/db.js";
import { hashSecret, temporaryPassword } from "../src/lib/auth.js";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, phone: { type: "string" }, additional: { type: "boolean", default: false } } });
const email = values.email?.trim().toLowerCase();
if (!email || !/^\S+@\S+\.\S+$/.test(email) || !values.name?.trim()) {
  console.error('Usage: npm run create-owner -- --email owner@company.in --name "Full Name" [--phone 98xxxxxxxx]');
  process.exit(1);
}

const db = createDb();
try {
  const owners = await db.user.count({ where: { role: "OWNER", status: "ACTIVE" } });
  if (owners > 0 && !values.additional) {
    console.error("An active owner already exists. Sign in as that owner to add users, or pass --additional to create another owner.");
    process.exit(1);
  }
  if (await db.user.findUnique({ where: { loginId: email } })) {
    console.error(`A user with ${email} already exists.`);
    process.exit(1);
  }
  const password = temporaryPassword();
  const user = await db.user.create({
    data: { loginId: email, email, phone: values.phone?.replace(/\s/g, "") || null, displayName: values.name.trim(), role: "OWNER", passwordHash: await hashSecret(password), mustChangePassword: true },
  });
  await db.auditLog.create({ data: { actorId: null, action: "user.owner_bootstrapped", entityType: "User", entityId: user.id, after: { email } } });
  console.log(`Owner created: ${email}`);
  console.log(`Temporary password (shown once, change it at first sign-in): ${password}`);
} finally {
  await db.$disconnect();
}
