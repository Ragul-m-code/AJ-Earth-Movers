# Project status (2026-10-19)

**Not production-ready.** The full operational and financial workflow works end to end against a real database, in both apps. What remains is listed at the bottom: production hosting, an installable APK, verified tax inputs, and a few business decisions.

## Built

### Backend (`backend/`)
- **Schema:**
  - People and access: users, per-module permissions, sessions, and drivers with effective-dated pay terms (hourly or fixed monthly).
  - Fleet and customers: customers and sites, customer-agreed machine and breaker rates, machines with default rates, attachments.
  - Work: work orders, meter readings and photos, reviews, the approved-work ledger.
  - Money: invoices and lines, payments and allocations, payroll runs and salary adjustments, business profile, tax rules.
  - Operations and records: maintenance, expenses, notifications, audit log.
- **Rules enforced on the server, with database transactions and constraints:**
  - Meter readings are numeric and non-negative with photos, end − start is computed, anomalies are flagged, and corrections append instead of overwriting.
  - Meter rollover and replacement are handled through an authorized correction that requires a reason.
  - A machine cannot have two open jobs on the same date. There is a database-level partial unique index as well as the service check.
  - Approval snapshots the driver's pay terms on the work date. Fixed-salary drivers get no per-hour amount.
  - Invoices:
    - Lines use the agreed customer rate: machine first, then category, then the machine default.
    - The breaker surcharge applies only to approved breaker hours.
    - Taxable value, CGST/SGST/IGST, tax and total are kept separately.
    - Numbering is per financial year: `AJ/2026-27/0001` for tax invoices and `AJ-PF/…` for proformas.
  - Each work record can be billed at most once (an atomic claim) and paid at most once (payroll claims it).
  - Tax invoices can't be issued until the business profile and the tax rule are verified, with the verifier and how it was verified recorded.
  - Payments are idempotent, allocations are checked under row locks, overpayment is refused, and any remainder is kept as customer credit.
  - Payroll: hourly runs sum each job at its own historical rate; fixed runs cover whole calendar months. A pay-terms change inside a fixed-salary period is refused rather than prorated by guesswork.
  - Adjustments need a second person's approval, and nobody can approve their own pay.
  - Roles: Owner has everything. Manager and Accounts get per-module permissions, editable by the owner. Drivers can only reach their own data.
- **Reports:** operating hours, utilization, customer billing, outstanding (aging), and driver earnings, each with CSV export. Every report states what its numbers mean.

### Driver app (`driver-app/`)
- All 20 driver modules, in your navy and orange brand with your logo and launcher icons.
- Shows fixed-salary and hourly pay terms correctly.

### Admin app (`admin-app/`)
- **Shell:** Android plus browser. Bottom tabs on phones, a left rail on wide screens.
- **Sign-in:** a forced password change after a temporary password.
- **Home:** dashboard and daily operations.
- **Work:** work orders, create, details, reassign, cancel; approval queue and history; meter review with zoomable photos, flags, machine meter history, breaker hours, approve, reject, and authorized correction.
- **Fleet:** machines (live status, add, edit, status change, default rates, meter history); attachments (surcharge history, billed usage); maintenance (schedule, start, which blocks assignment, complete).
- **Finance:**
  - Invoices: choose the work, then build the draft (charges, discounts, tax rule, issue blockers), issue, cancel, and PDF or print.
  - Payments with allocation.
  - Payroll: preview, draft, approve, paid; adjustments.
  - Expenses.
- **More:**
  - Customers: list, profile, sites, agreed rates, ledger, edit.
  - Drivers: list, profile, PIN reset, status, pay terms with history, work history, adjustments.
  - Users & roles: owner only.
  - Reports with CSV export, business profile and tax verification, operational settings, audit log, notifications, profile and password.
- **Screens added where no Stitch design existed:** recording payments, preparing payroll, the customer form, operational settings, the audit log, reports.

## Tested
- **Backend:** `npm test` passes 69 tests (35 unit, 34 integration), covering all 16 required cases in the brief §11, plus:
  - permissions and the forced password change;
  - double-booking under concurrency;
  - CSV export.
- **Code checks:** `tsc --noEmit` and `expo lint` are clean for both apps.
- **Driver app on a real phone** (Realme RMX1851, Android 11, Expo Go over USB):
  - Sign-in and live data.
  - Camera permission, capture and preview.
  - Native photo upload and the server-side anomaly flag.
- **Admin app in the browser** (2026-10-19, sample data, signed in as Accounts):
  - Approve 9.0 h, then draft a tax invoice: it is blocked with the reasons listed. Discard it, and the work is released.
  - Issue a proforma: AJ-PF/2026-27/0001, ₹22,500 (3 jobs × ₹1,250 agreed category rate), due in 30 days.
  - A part payment of ₹10,000 leaves a ₹12,500 balance and the status Part paid.
  - Payroll: preview, then draft, approve and paid at ₹3,800 net (26.5 h, 3 working days, at the ₹140 and ₹150 historical rates).
  - No console errors.
- **Admin app on a real phone** (2026-10-19, same Realme, Expo Go, signed in as Owner):
  - Sign-in, and the session survives an app restart.
  - Dashboard, Work, Fleet, Finance and More all load with live data.
  - Create work order: the native pickers work. Double-booking UNIT-15 is refused with a clear message. WO-2026-0008 was created on UNIT-21 for DRV-106.
  - Invoice PDF opens in the Android print preview with correct totals.
  - Reports CSV opens the Android share sheet.
  - Fixed for large phone font sizes: segment labels shrink to fit, the invoice PDF button label is shorter, and the role badge on More sits under the name.

- **Full workflow on real devices** (2026-10-19, Realme phone with both apps, plus the production admin web build). Every step below was done with the driver photographing the meter and typing the reading; there is no OCR.
  - The admin creates a job for a newly added driver. Double-booking is refused.
  - The driver accepts the job. Submitting without a photo is refused. The driver records start and end readings with photos (downscaled to 1600 px).
  - The reading is flagged because the meter hours exceed the clock time. The manager rejects it with a reason. The driver corrects it, and the original stays on record as revision 1.
  - The admin approves 0.5 h. Proforma AJ-PF/2026-27/0002 for ₹625 is issued and fully paid.
  - Payroll for a driver who joined mid-month: ₹80, taken through approved to paid.
- **Fixed during the run:**
  - Payroll for a driver whose hourly pay starts mid-month.
  - Button labels breaking mid-word.
  - Status badge overflow.
  - Sign-in screens scrolling under the status bar.
  - A search icon on the payment reference field.
- **Security review:** see [SECURITY.md](SECURITY.md). 82 backend tests pass, including the new cross-driver isolation, session, lockout, CSV and storage tests.
- **New screens:** 404, crash screen, offline view that reloads by itself, branded start-up screen, and an admin "can't reach the server" screen that keeps the session.
- **Photo storage monitoring:** usage against the quota, a dashboard warning, and owner alerts at 80% and 95%.
- **Deployment ready:** Vercel config for the API and the admin web app, a private Blob photo store, and EAS profiles for the phone apps. See [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md).

- **Live (2026-10-20):** API at `aj-earth-movers.vercel.app` and admin site at `aj-earth-movers-admin-app.vercel.app`. The Owner can sign in. Live security checks pass (401 without a sign-in, other sites get no CORS access, security headers present).
- **Accessibility:** an axe audit (WCAG 2.1 A/AA) of 23 admin screens now reports zero violations. Fixed: text contrast, logo alt text, filter-chip roles, unlabelled spinners.
- **Backend tests:** 83 pass.

## Remaining
1. **Tax:** your accountant enters and verifies the real GSTIN, tax rule and SAC code (More › Business profile & tax). Until then only proformas can be issued.
2. **Admin logo:** the file supplied is a 144 px image inside an SVG, so the admin launcher icon is soft. Please supply a vector SVG or a PNG of at least 1024 px.
3. **Installable APKs:** Windows long-path support or an EAS cloud build.
4. **Production:**
   - Hosting with HTTPS.
   - A managed PostgreSQL with backups.
   - A private object store for photos (S3/GCS behind the existing storage interface).
   - Error monitoring.
   - Push notifications (currently in-app only).
5. **Not built:**
   - Credit notes for invoices that already have payments (cancellation is blocked instead).
   - E-invoicing or e-way bill.
   - Editing a draft invoice's period after creation.
6. **Decisions** listed in `DECISIONS_NEEDED.md`, notably the maximum hours per job (16 h is a placeholder) and the fixed-salary proration policy.
