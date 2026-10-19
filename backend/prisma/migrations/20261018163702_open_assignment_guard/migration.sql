-- A machine can have at most one open work order (assigned, accepted or in progress) per work date.
-- The service checks this too; the index makes it impossible even under concurrent requests.
CREATE UNIQUE INDEX "WorkOrder_one_open_per_vehicle_date"
  ON "WorkOrder" ("vehicleId", "workDate")
  WHERE "status" IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS');

-- Money and hours can never be negative where the rules forbid it.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "ApprovedWork" ADD CONSTRAINT "ApprovedWork_hours_nonnegative" CHECK ("approvedHours" >= 0 AND "breakerHours" >= 0 AND "breakerHours" <= "approvedHours");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_paid_within_total" CHECK ("amountPaid" >= 0 AND "amountPaid" <= "total");
