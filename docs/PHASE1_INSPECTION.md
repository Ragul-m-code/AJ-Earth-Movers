# Phase 1 — Inspection Report

Source: `stitch_aj_earth_movers_fleet_system.zip` (extracted to `design-reference/`).

## What the ZIP actually contains

- 27 folders. 26 contain one `code.html` and one `screen.png`. One contains a design-system spec (`heavy_industrial_precision/DESIGN.md`).
- **Static mockups only.** Every screen is a standalone HTML page using the Tailwind Play CDN (`cdn.tailwindcss.com`), an inline `tailwind.config`, Google Fonts (Inter and Material Symbols) and 38 remote images on `lh3.googleusercontent.com` (logo and machine/meter photos).
- There is no framework, package.json, build setup, routing, backend, data model or shared components. The inline JS only toggles demo states ("Demo Simulator", "QA Harness" bars).
- All data is hardcoded sample data (Ramesh Kumar, WO-2024-892, CAT 320D, etc.).

## Screen inventory → required modules

### Driver app (21 screens + 1 IA spec)

| # | Required driver module | Stitch screen(s) | Status |
|---|---|---|---|
| 1 | Login | `driver_app_login_operator_auth` | Designed |
| 2 | Home dashboard | `driver_home_dashboard_main_operator_hud`, `driver_home_active_shift_hud` | Designed (2 variants) |
| 3 | Assigned jobs | `driver_my_work_assigned_jobs`, `driver_my_work_upload_retry_hub` | Designed (2 overlapping variants) |
| 4 | Work-order details | `job_details_shift_assignment_operator_actions` | Designed |
| 5 | Accept / decline | same as 4 (footer actions) | Designed. No decline-reason dialog |
| 6 | Vehicle & attachment details | `driver_vehicle_attachment_details` | Designed |
| 7 | Starting meter entry | `start_work_starting_hour_meter_entry` | Designed |
| 8 | Starting meter photo capture / preview | `driver_camera_viewfinder_meter_capture`, `driver_meter_photo_preview_verification` | Designed |
| 9 | Ending meter entry | `driver_end_work_ending_hour_meter_entry` | Designed |
| 10 | Ending meter photo capture / preview | `driver_ending_meter_camera_verification` | Designed |
| 11 | Operating-hours review | `driver_work_hours_review_submission` | Designed |
| 12 | Submission confirmation | `driver_work_submission_confirmation` | Designed |
| 13 | Pending approval | `driver_pending_admin_verification_audit_status` | Designed |
| 14 | Rejected / correction | `rejected_work_submission_audit_resolution` | Designed |
| 15 | Work history | `driver_work_history_shift_logs` | Designed |
| 16 | Daily / monthly summaries | `driver_daily_analytics_hours_breakdown`, `driver_monthly_analytics_hours_breakdown` | Designed |
| 17 | Earnings history | `driver_earnings_history_wage_ledger` | Designed |
| 18 | Profile | `driver_profile_account_governance` | Designed |
| 19 | Notifications | `driver_notifications_alert_stream` | Designed |
| 20 | Help & logout | `driver_help_account_actions` | Designed. Logout confirm only as a demo state |
| — | Navigation spec | `driver_navigation_ia_specification` | 4 tabs: Home, My Work, Analytics, Profile |

**Driver coverage: all 20 modules have a design.**

### Admin app (3 screens, still in progress)

| Stitch screen | Covers |
|---|---|
| `admin_navigation_information_architecture` | 5-tab IA (Dashboard, Work, Fleet, Finance, More) + RBAC matrix (Owner / Fleet Mgr / Accounts) |
| `admin_more_hub_secondary_navigation` | "More" hub linking to staff, wage rules, tax, company profile, audit log |
| `meter_verification_deep_link_destination` | Meter review: photos, start − end = hours, approve / flag |

The other ~29 admin modules (vehicles, customers, invoices, payroll, tax, reports and the rest) have **no designs yet**.

## Conflicts between the designs and the confirmed business rules

These have to be fixed during implementation. The business rules take precedence.

| Design element | Rule violated | Resolution |
|---|---|---|
| "Submissions queued locally", "local encrypted hardware cache", "Cache Inspect", "View Cached Unsent Shift Proofs" | **D: no offline recording** | Remove. Show an explicit "Not saved, needs internet" failed state with retry. The draft stays only in memory for the current screen, and an idempotency key prevents duplicates. |
| "AI OCR confidence 99.4%", "OCR Match", "Optical lock" | Not a requirement, and the claims would be fabricated | Remove. The driver types the reading and the admin compares it with the photo. |
| GPS geofence / "GPS locked" / EXIF hash / SHA-256 sign / "cryptographically signed" | Not a requirement, and nothing is implemented to back them | Remove the claims. Show only facts the server records: server timestamp, uploader, photo. |
| "Overtime 1.5x", "Night shift bata", "Safety deductions" shown as rate rules | **B: pay = hours × rate + authorized additions − deductions** | Model these only as named, authorized **adjustments**. No automatic OT multiplier. |
| "₹ Estimated pay" shown before approval | B / C: only approved hours are payable | Label as "Estimate, not approved" or hide. Credited amounts only after payroll approval. |
| "HTTP 201 CREATED • cryptographically signed" | D: be truthful about backend state | Show "Submitted, awaiting admin approval" only after the server confirms. |
| "Approve 9.0 Hours & Post to Billing" (admin) | E / F | Approval makes hours *eligible* for billing. Invoicing is a separate step. |
| "GST & SAC Tax Profile 18% Active, SAC 997312" (admin More hub) | **F: tax not verified** | Show "Unverified" until an owner verifies it. Do not prefill any rate or SAC code. |
| Safety pre-trip checklist, fuel %, hydraulic pressure, PM service | Not required, and no data source exists | Drop for v1, or keep as static text only. |
| Emergency button `tel:911` | Wrong for India | Use 112, or the configured dispatch number. |
| Demo Simulator / QA harness bars on every screen | Mockup tooling | Remove. Real states come from data. |
| Hardcoded supervisor names, phone numbers, IMEI | Fake data | Replace with real data. Seed data is clearly labelled sample data. |

## Design-system inconsistencies

- `DESIGN.md` specifies a slate canvas (`#F8FAFC`) and charcoal `#20242B`. The HTML uses Material-generated tokens (`surface #f8f9ff`, `primary #795900`, `inverse-surface #213145`). These drift toward blue and brown.
- The border-radius scale in the HTML config (`lg = 0.25rem`, `xl = 0.5rem`) differs from DESIGN.md (`lg = 0.5rem`, `xl = 0.75rem`).
- Some screens (login, camera, history) use a monospace font for numbers. Others use Inter with tabular figures.
- The logo is a remote Google-hosted image, not a local asset.
- Several cards are duplicated across the home and My Work variants.

**Decision:** one shared token set based on DESIGN.md plus the brand palette (`#F5B800`, `#20242B`, `#FFFFFF`, slate neutrals), with a local SVG logo mark.

## Highest-risk business rules

1. Meter approval state machine. Only approved hours may reach billing or payroll, and corrections must never overwrite the original reading.
2. Duplicate invoicing. Each approved submission may be billed at most once. This needs a DB-level unique constraint.
3. Historical driver and vehicle rates. Store the effective-dated rate on each record at approval time.
4. Tax-unverified finalisation guard. This must be enforced on the server.
5. Working days counted as distinct IST dates, not jobs.
6. Idempotent submissions when connectivity is poor.
