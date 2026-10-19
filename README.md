# AJ Earth Movers Fleet Management

One shared backend and two Expo (React Native) apps:

| Folder | What it is |
|---|---|
| `backend/` | Node 22 + TypeScript, Fastify 5, Prisma 6, PostgreSQL. All business rules, calculations and permissions. |
| `driver-app/` | Driver app (Android; web preview for layout checks). Branded "AJ Earth Movers · DRIVER". |
| `admin-app/` | Admin app for the owner, managers and accounts staff. Runs on Android and in a browser. Branded "AJ Earth Movers · CONTROL". |
| `design-reference/` | Stitch exports (driver and admin) and the brand logo files. Visual reference only. |
| `docs/` | Inspection report, project status and open business decisions. |

Start with [docs/STATUS.md](docs/STATUS.md) for what works and what remains, and [docs/DECISIONS_NEEDED.md](docs/DECISIONS_NEEDED.md) for what needs the owner's input.

## Prerequisites

- Node.js 22+
- PostgreSQL 16+ on port **5433**. Port 5433 avoids clashing with an existing PostgreSQL service on 5432. Two local options:
  - **No Docker:** `npm run db:local` in `backend/` runs an embedded PostgreSQL, with data in `backend/.pgdata`.
  - **Docker:** `docker compose up -d` at the repo root.
- To run the apps on a phone: **Expo Go** (installed automatically over USB by `expo start --android`).

## Backend

```bash
cd backend
npm install
cp .env.example .env          # dev defaults; never commit .env
npm run db:local              # terminal 1: leave running (or use docker compose)
npx prisma migrate deploy     # create or upgrade the tables
npm run dev                   # API on http://localhost:4000
```

### First owner account (real installations)

```bash
npm run create-owner -- --email owner@yourcompany.in --name "Full Name" --phone 98xxxxxxxx
```

This prints a one-time temporary password, and the owner must choose a new one at first sign-in. The owner then creates staff accounts and drivers from the admin app (More › Users & roles, More › Drivers). Self-registration is not possible.

### Sample data (development only)

```bash
npm run db:seed:sample
```

It creates records labelled "(Sample)", and the sign-in credentials are listed at the top of `backend/scripts/seed-sample.ts`. It includes:
- an owner, a manager and an accounts user;
- an hourly driver and a fixed-salary driver;
- two customers with agreed rates, and three machines with a breaker.

No business profile or tax rule is verified. That is left to your accountant.

### Tests

```bash
npm run test:unit   # business-rule tests, no database
npm test            # unit + API integration tests (needs the database running; uses aj_fleet_test, wiped on each run)
```

## Admin app

```bash
cd admin-app
npm install
cp .env.example .env      # EXPO_PUBLIC_API_URL
npx expo start --web --port 8082     # browser
npx expo start --android             # phone, via Expo Go
```

## Driver app

```bash
cd driver-app
npm install
cp .env.example .env
npx expo start --android
```

### Running on a phone over USB

1. Forward the ports over the cable. This needs redoing whenever the phone reconnects:

   ```bash
   adb reverse tcp:4000 tcp:4000
   ```

   ```bash
   adb reverse tcp:8081 tcp:8081
   ```

2. Start Metro advertising IPv4 localhost:

   ```bash
   REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 npx expo start --lan --port 8081
   ```

3. Keep `EXPO_PUBLIC_API_URL=http://localhost:4000`.

Over Wi-Fi instead, set `EXPO_PUBLIC_API_URL` to the computer's LAN IP.

### Installable APKs

The local Android build fails on Windows because of the 260-character path limit. Either enable Win32 long paths, or build in the cloud with `npx eas-cli@latest build --platform android --profile preview`, which needs an Expo account. Both apps include `eas.json`.

## Deploying

See [docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md): the backend and the admin web app become two Vercel projects, photos go to a private Vercel Blob store, and the phone apps are built with EAS.

## Environment variables

`backend/.env.example` documents each one:

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DIRECT_URL`, `TEST_DATABASE_URL` | PostgreSQL connections: pooled for queries, direct for migrations (the same URL locally). The test database is wiped on every test run. |
| `PORT`, `HOST` | API listen address |
| `CORS_ORIGINS` | Browser origins allowed (driver web 8081, admin web 8082). Native apps don't need CORS. |
| `PHOTO_STORAGE` | `local` (disk, under `PHOTO_STORAGE_DIR`) or `vercel-blob` (a private Vercel Blob store, required on Vercel) |
| `PHOTO_STORAGE_DIR`, `PHOTO_MAX_BYTES` | Local photo directory, and the upload limit (4 MB, under Vercel's 4.5 MB body limit). Photos are never served statically. |
| `SESSION_TTL_HOURS` | Driver session lifetime. Admin sessions are capped at 72 h. |
| `LOGIN_ATTEMPTS_PER_MINUTE` | Sign-in rate limit per IP |

Each app's `.env` holds `EXPO_PUBLIC_API_URL`, which Expo inlines at build time, so it must never contain a secret.

All dates use **Asia/Kolkata**, and money is shown in **₹** with Indian digit grouping.
