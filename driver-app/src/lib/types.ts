// Shapes returned by the backend driver API (backend/src/services/serialize.ts and routes/driver.ts).
export type WorkOrderStatus =
  | "ASSIGNED"
  | "ACCEPTED"
  | "DECLINED"
  | "IN_PROGRESS"
  | "PENDING_APPROVAL"
  | "CORRECTION_REQUIRED"
  | "APPROVED"
  | "CANCELLED";

export type MeterKind = "START" | "END";

export interface Reading {
  id: string;
  kind: MeterKind;
  revision: number;
  value: string;
  photoUrl: string;
  note: string | null;
  flags: string[];
  submittedAt: string;
  supersedesId: string | null;
}

export interface WorkOrderSummary {
  id: string;
  code: string;
  status: WorkOrderStatus;
  workDate: string;
  shiftLabel: string | null;
  siteName: string;
  siteAddress: string | null;
  customer: { name: string };
  vehicle: { unitCode: string; registrationNo: string; make: string; model: string; category: string };
  attachments: { code: string; name: string; type: string }[];
  plannedHours: string | null;
  start: Reading | null;
  end: Reading | null;
  operatingHours: string | null;
  latestReview: { decision: "APPROVED" | "REJECTED"; reason: string | null; correctionTarget: "START" | "END" | "BOTH" | null; createdAt: string } | null;
  correctionNeeded: { start: boolean; end: boolean };
  approved: { hours: string; driverRate: string | null; compensationMethod: "HOURLY" | "FIXED"; driverAmount: string; inPayroll: boolean } | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

export interface WorkOrderDetail extends WorkOrderSummary {
  flags: string[];
  instructions: string | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
  declineReason: string | null;
  vehicleNotes: string | null;
  vehicleLastApprovedMeter: string | null;
  attachmentsDetail: { code: string; name: string; type: string; notes: string | null }[];
  readings: Reading[];
  reviews: { decision: string; reason: string | null; correctionTarget: string | null; computedHours: string; approvedHours: string | null; createdAt: string }[];
  events: { fromStatus: WorkOrderStatus | null; toStatus: WorkOrderStatus; note: string | null; createdAt: string }[];
}

export interface WorkOrderList {
  items: WorkOrderSummary[];
  total: number;
  page: number;
  pageSize: number;
  groupCounts: Record<string, number>;
}

export interface Compensation {
  method: "HOURLY" | "FIXED";
  hourlyRate: string | null;
  monthlySalary: string | null;
  effectiveFrom: string;
}

export interface Me {
  id: string;
  driverCode: string;
  fullName: string;
  phone: string;
  emergencyContact: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  joinedOn: string | null;
  status: string;
  compensation: Compensation | null;
  today: string;
}

export interface MonthSummary {
  month: string;
  approvedHours: string;
  pendingHours: string;
  workingDays: number;
  approvedJobs: number;
  pendingJobs: number;
  approvedEarnings: string;
  days: { date: string; approvedHours: string; pendingHours: string; approvedJobs: number; pendingJobs: number }[];
}

export interface Earnings {
  compensation: Compensation | null;
  compensationHistory: Compensation[];
  notYetInPayroll: { hours: string; amount: string; jobs: number; workingDays: number };
  payrolls: {
    id: string;
    periodStart: string;
    periodEnd: string;
    status: "APPROVED" | "PAID";
    method: "HOURLY" | "FIXED";
    fixedSalary: string | null;
    approvedHours: string;
    workingDays: number;
    grossAmount: string;
    additionsTotal: string;
    deductionsTotal: string;
    netAmount: string;
    paidAt: string | null;
    paymentMode: string | null;
    paymentRef: string | null;
    adjustments: { kind: "ADDITION" | "DEDUCTION"; amount: string; description: string; effectiveOn: string }[];
  }[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  workOrderId: string | null;
  readAt: string | null;
  createdAt: string;
}
export interface NotificationList {
  unread: number;
  items: NotificationItem[];
}

export interface Support {
  dispatchPhone: string | null;
  payrollPhone: string | null;
  emergencyPhone: string | null;
}
