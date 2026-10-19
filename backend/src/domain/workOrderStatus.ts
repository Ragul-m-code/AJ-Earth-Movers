export const WorkOrderStatus = {
  ASSIGNED: "ASSIGNED",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  IN_PROGRESS: "IN_PROGRESS",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  CORRECTION_REQUIRED: "CORRECTION_REQUIRED",
  APPROVED: "APPROVED",
  CANCELLED: "CANCELLED",
} as const;
export type WorkOrderStatus = (typeof WorkOrderStatus)[keyof typeof WorkOrderStatus];

export type Actor = "driver" | "admin";

/** Every allowed transition and who may perform it. Anything not listed is rejected. */
const TRANSITIONS: Record<WorkOrderStatus, Partial<Record<WorkOrderStatus, Actor>>> = {
  ASSIGNED: { ACCEPTED: "driver", DECLINED: "driver", CANCELLED: "admin" },
  ACCEPTED: { IN_PROGRESS: "driver", CANCELLED: "admin" },
  DECLINED: { ASSIGNED: "admin", CANCELLED: "admin" },
  IN_PROGRESS: { PENDING_APPROVAL: "driver" },
  PENDING_APPROVAL: { APPROVED: "admin", CORRECTION_REQUIRED: "admin" },
  CORRECTION_REQUIRED: { PENDING_APPROVAL: "driver" },
  APPROVED: {},
  CANCELLED: {},
};

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus, actor: Actor): boolean {
  return TRANSITIONS[from][to] === actor;
}
