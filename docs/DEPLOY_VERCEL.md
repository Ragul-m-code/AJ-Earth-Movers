# Deploying to Vercel

The system deploys as **two Vercel projects from this one repository**, plus a database and a photo store:

| Piece | Where it runs | Vercel "Root Directory" |
|---|---|---|
| Backend API (Fastify) | Vercel Function, region `bom1` (Mumbai) | `backend` |
| Admin web app (Expo web export) | Vercel static site | `admin-app` |
| PostgreSQL | Managed Postgres (Neon or Supabase, Mumbai region) | — |
| Meter photos | **Private** Vercel Blob store | — |
| Driver app, admin Android app | Phones (EAS builds, not Vercel) | — |

Vercel's disk is not persistent, so photos **must** go to the private Blob store. The API refuses to start on Vercel with `PHOTO_STORAGE=local`.

## 1. Database

1. Create a Postgres database in **AWS ap-south-1 (Mumbai)**, so it sits next to the `bom1` function region.
2. Copy two connection strings:
   - **Pooled** (PgBouncer / "pooler"), for `DATABASE_URL`. Add `?pgbouncer=true&connection_limit=1&sslmode=require`.
   - **Direct** (non-pooled), for `DIRECT_URL`. Migrations use it.

Migrations run automatically on **production** deployments (`scripts/vercel-build.mjs`). Preview deployments never touch the schema.

## 2. Backend project

1. In Vercel, choose **Add New → Project**, import this repository, and set **Root Directory = `backend`**. Vercel detects Fastify from `src/server.ts`. Leave the build and output settings empty.
2. Go to **Storage → Create → Blob**, choose **Private** access, and connect the store to this project. That adds `BLOB_STORE_ID` and the OIDC credentials. A `BLOB_READ_WRITE_TOKEN` works too.
3. Set these environment variables (Production):

| Variable | Value |
|---|---|
| `DATABASE_URL` | pooled connection string |
| `DIRECT_URL` | direct connection string |
| `PHOTO_STORAGE` | `vercel-blob` |
| `CORS_ORIGINS` | the admin site URL, e.g. `https://aj-control.vercel.app` (comma-separate several) |
| `NODE_ENV` | `production` |
| `SESSION_TTL_HOURS` | `336` (optional) |
| `LOGIN_ATTEMPTS_PER_MINUTE` | `10` (optional) |
| `PHOTO_MAX_BYTES` | leave at the 4 MB default. Vercel rejects request bodies over 4.5 MB. |
| `TRUST_PROXY` | leave unset. It switches on automatically on Vercel, which overwrites `X-Forwarded-For`. Set `true` only behind a proxy that does the same. |

4. Deploy, then open `https://<backend>.vercel.app/api/health`. It should return OK.
5. Create the first owner account once, from your computer, against the production database:
   ```bash
   cd backend
   DATABASE_URL="<direct url>" npm run create-owner
   ```
   **Never** run `db:seed:sample` against production.

## 3. Admin web project

1. Add a second project from the same repository, with **Root Directory = `admin-app`**. `vercel.json` already sets the build (`expo export --platform web`), the output (`dist`), the fallback for client-side routes, and security headers.
2. Set `EXPO_PUBLIC_API_URL` to the backend URL, e.g. `https://aj-api.vercel.app`. It is built into the bundle. The build **fails on purpose** if it is missing or still points at localhost.
3. Deploy, and then put this site's URL into the backend's `CORS_ORIGINS`. Redeploy the backend afterwards.

## 4. Phone apps (EAS)

Both apps contain `eas.json`. For each app:
```bash
cd driver-app            # or admin-app
npx eas-cli@latest login
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_URL --value https://aj-api.vercel.app --environment preview --environment production
npx eas-cli@latest build -p android --profile preview      # installable APK for testing
npx eas-cli@latest build -p android --profile production   # Play Store bundle
```
Native apps do not need CORS.

## Checklist after the first deploy

- [ ] `/api/health` returns OK.
- [ ] Owner sign-in works on the admin site. Change the temporary password when asked.
- [ ] Add one real driver, machine, customer, and their effective-dated rates.
- [ ] On a phone (APK), the driver signs in, accepts a job, and submits start and end readings with photos.
- [ ] In admin, both photos open on the review screen. This confirms the private Blob store is working.
- [ ] In **More → Operational settings**, set **Photo storage quota (GB)** to your Blob plan's size. Owners are alerted at 80% and 95%.
- [ ] Enter and **verify** the business profile and tax rule before issuing any tax invoice (see `DECISIONS_NEEDED.md`).

## Photo storage

Photos are compressed **once, on the phone** (1600 px JPEG, roughly 0.2–0.6 MB) and then kept unchanged. They are billing and payroll evidence, and each one's SHA-256 is recorded, so the system never re-compresses or deletes them automatically. Instead:
- The admin dashboard and Operational settings show usage against the quota, with a forecast of when it fills.
- Owners get a notification at 80% and 95%. Uploads keep working, so drivers are never blocked mid-job.
- When it fills, upgrade the Blob plan and raise the quota. Agree a retention period with your accountant (GST records are generally kept for several years) before deleting anything.

## Limits to know

- **Uploads:** 4.5 MB per request. The driver app downscales meter photos to 1600 px (about 0.2–1 MB) before upload.
- **Rate limiting:** the sign-in limit is counted per function instance. Add Vercel Firewall rate limiting on `/api/auth/*` for a hard limit.
- **Database:** each function instance keeps one pooled connection. Keep `connection_limit=1` on the pooled URL.
