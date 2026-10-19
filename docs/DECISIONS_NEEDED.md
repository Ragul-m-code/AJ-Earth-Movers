# Decisions and inputs needed from AJ Earth Movers

None of these values have been invented. Where the system needs a value to run, it uses a clearly marked placeholder that can be changed later.

## Confirmed by the owner

- **Meter readings (2026-10-19): no OCR.** The driver takes a camera photo of the hour meter as proof and types the reading. An admin compares the typed value with the photo before approving. Nothing reads the photo automatically.

## Business rules to confirm

| # | Question | Current behaviour |
|---|---|---|
| 1 | **Maximum operating hours for one job** before a reading is flagged as suspicious. | Placeholder of **16 h** (`meter.maxJobHours` in AppSetting). A higher value is flagged for review, never rejected. |
| 2 | **Clock-time tolerance**: how much more meter time than wall-clock time (between start and end submissions) is allowed. | **0.5 h** (`meter.elapsedToleranceHours`). |
| 3 | Which date counts as the **work date** for jobs that cross midnight? | The work order's scheduled date. Working days and rates are keyed on it. |
| 4 | Can **Accounts** staff approve meter readings? | Yes, following the RBAC matrix in the Stitch admin design (Owner, Fleet Manager and Accounts all ticked). Drivers can never approve, and nobody can approve their own submission. |
| 5 | Should drivers be able to upload a meter photo **from the gallery**, or only take one with the camera? | Camera only, to reduce the risk of reused photos. The Stitch design shows a "From Gallery" option. |
| 6 | Driver PIN length. | 4–6 digits, per the login design. The account locks for 15 minutes after 5 failed attempts. |
| 7 | **Overtime, night bata and safety deductions** (shown in the Stitch earnings designs). | Not built as automatic rules. The confirmed rule is hours × rate + authorized additions − authorized deductions, so these become named adjustments an admin authorizes. |
| 8 | When a driver **declines** a job, does it go back to the same driver or to dispatch for reassignment? | Status becomes DECLINED. Dispatch reassigns it from the admin app; the job returns to ASSIGNED and the new driver is notified. |
| 9 | **Fixed salary when pay terms change mid-month.** | Refused: split the payroll into two periods. No proration formula is assumed. Fixed-salary runs cover whole calendar months. |
| 10 | **Breaker hours** when a breaker is assigned. | Defaults to all approved hours. The reviewer can lower it, down to 0 for no breaker charge. |
| 11 | **Who verifies tax settings.** | Only users with the "Verify tax settings" permission (the owner by default). Verification records who verified and how. |
| 12 | **Cancelling an invoice that has payments.** | Blocked. A credit-note workflow is not built yet; agree the treatment with your accountant. |

## Real data needed before production

- Company legal name, address, and **GSTIN** (not invented).
- **GST rate, SAC code and tax treatment.** The Stitch admin "More" hub shows "18% / SAC 997312". This is **not** used, because tax is unverified (rule F).
- Dispatch, payroll and emergency phone numbers. The app shows "Not configured" until set. National emergency **112** is the only default; the Stitch design's `tel:911` was wrong for India.
- Real drivers, vehicles, attachments, customers, and their **effective-dated hourly rates**. Approval refuses to proceed when no rate exists for the work date.
- Hosting choice: managed PostgreSQL with backups, plus a private object store (S3, GCS or similar) for photos.

## Design conflicts resolved in favour of the business rules

See [PHASE1_INSPECTION.md](PHASE1_INSPECTION.md#conflicts-between-the-designs-and-the-confirmed-business-rules). In short:
- No offline queue or local cache.
- No AI/OCR, GPS or "cryptographic signature" claims.
- No estimated pay shown as credited.
- No demo-simulator bars.
