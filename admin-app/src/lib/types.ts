// Shapes returned by /api/admin (backend/src/services/*). Kept close to the server DTOs.
export interface Reading {
  id: string;
  kind: "START" | "END";
  revision: number;
  value: string;
  photoUrl: string;
  note: string | null;
  flags: string[];
  submittedAt: string;
  supersedesId: string | null;
}

export interface WorkOrderItem {
  id: string;
  code: string;
  status: string;
  workDate: string;
  shiftLabel: string | null;
  siteName: string;
  siteAddress: string | null;
  customer: { name: string };
  customerId: string;
  vehicleId: string;
  vehicle: { unitCode: string; registrationNo: string; make: string; model: string; category: string };
  driver: { id: string; driverCode: string; fullName: string; phone?: string };
  attachments: { code: string; name: string; type: string }[];
  plannedHours: string | null;
  start: Reading | null;
  end: Reading | null;
  operatingHours: string | null;
  latestReview: { decision: string; reason: string | null; correctionTarget: string | null; createdAt: string } | null;
  approved: { hours: string; driverRate: string | null; driverAmount: string; inPayroll: boolean } | null;
  flags: string[];
  submittedAt: string | null;
}

export interface WorkOrderDetail extends WorkOrderItem {
  instructions: string | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
  declineReason: string | null;
  cancelReason: string | null;
  createdBy: string;
  vehicleLastApprovedMeter: string | null;
  attachmentsDetail: { id: string; code: string; name: string; type: string; chargeable: boolean; notes: string | null }[];
  readings: Reading[];
  reviews: { decision: string; reason: string | null; correctionTarget: string | null; computedHours: string; approvedHours: string | null; adjustmentKind: string | null; adjustmentReason: string | null; breakerHours: string | null; reviewer: string; createdAt: string }[];
  events: { fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[];
  ledger: { approvedHours: string; breakerHours: string; compensationMethod: string; driverRate: string | null; driverAmount: string; invoice: { id: string; number: string | null; status: string } | null; payrollRunId: string | null } | null;
  vehicleHistory: { workDate: string; startMeter: string; endMeter: string; approvedHours: string }[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Lookups {
  customers: { id: string; name: string; sites: { id: string; name: string; address: string | null; contactName: string | null; contactPhone: string | null }[] }[];
  vehicles: { id: string; unitCode: string; registrationNo: string; make: string; model: string; category: string; status: string }[];
  drivers: { id: string; driverCode: string; fullName: string; phone: string }[];
  attachments: { id: string; code: string; name: string; type: string; chargeable: boolean }[];
  categories: string[];
  paymentModes: string[];
}

export const FLAG_TEXT: Record<string, string> = {
  END_BELOW_START: "Ending reading is lower than starting reading (possible rollover or typo)",
  ZERO_HOURS: "Zero operating hours",
  EXCEEDS_MAX_JOB_HOURS: "More hours than the configured maximum for one job",
  EXCEEDS_ELAPSED_TIME: "Meter hours exceed clock time between submissions",
  START_BELOW_VEHICLE_HISTORY: "Starting reading is below this machine's last approved reading",
};
