import type { Db } from "../db.js";
import { notFound } from "../lib/errors.js";

export async function listNotifications(db: Db, userId: string, opts: { unreadOnly: boolean; limit: number }) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: opts.limit,
    }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return {
    unread,
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      workOrderId: n.workOrderId,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

export async function markRead(db: Db, userId: string, id: string | "all") {
  if (id === "all") {
    await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return;
  }
  const res = await db.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
  if (res.count === 0) throw notFound("Notification");
}
