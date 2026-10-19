import type { Prisma } from "@prisma/client";
import type { Tx } from "../db.js";

export async function audit(
  tx: Tx,
  entry: {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    reason?: string;
  },
): Promise<void> {
  await tx.auditLog.create({ data: entry });
}
