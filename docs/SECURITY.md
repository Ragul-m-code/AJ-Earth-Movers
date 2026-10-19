# Security model

## Access control
- **Server-side enforcement.** Every admin service checks the caller's permission itself. The apps only hide buttons; hiding them is not what makes the system secure.
- **Driver isolation.** Every driver query is filtered by the signed-in driver's ID: jobs, readings, photos, earnings, pay history, summaries and notifications. Another driver's record returns **404**, so the system does not even confirm it exists. A job can be reassigned only before it is accepted, so no readings or photos ever pass to a second driver. `test/integration/security.test.ts` covers these cases.
- **Roles.** Only an Owner manages users. Nobody can grant the `USERS` permission or remove their own Owner role. Permissions are re-read on every request, so changes apply immediately.
- **Temporary passwords.** An office user on a temporary password can only change it. This also applies to viewing photos.

## Sessions and sign-in
- **Tokens.** Opaque 256-bit tokens, stored only as SHA-256 hashes. Office sessions last at most 72 h; driver sessions 14 days.
- **Revocation.** Sessions end immediately on deactivation, PIN or password reset, and password change (other devices). A deactivated driver's token is refused even if a session row survived.
- **Brute force.**
  - Sign-in and password change are limited to 10 attempts per minute per IP.
  - An account locks for 15 minutes after 5 failures. The counter is atomic, so parallel guesses cannot slip under the limit.
  - Unknown IDs take as long to reject as real ones.
- **Client IP.** `X-Forwarded-For` is trusted only on Vercel, or when `TRUST_PROXY=true`, so clients cannot spoof the IP used for the sign-in limit.

## Data
- **Photos.** Private storage: local disk outside any public folder, or a private Vercel Blob store. Photos are served only through an authorized route with `no-store`. The file type is detected from the file's bytes, not from what the client claims.
- **CSV exports.** Cells that could run as spreadsheet formulas are neutralised, including ones that start with a number, like `-1+HYPERLINK(…)`.
- **Invoice print/PDF.** The document escapes all text and carries a CSP that blocks scripts. The print window is cut off from the app window.
- **Admin website.** A strict Content-Security-Policy (`script-src 'self'`, no inline scripts), plus `frame-ancestors 'none'`, `nosniff` and a Permissions-Policy that disables the camera, microphone and location.
- **Sample data.** The seed script refuses to run on Vercel, in production, or against any database that is not on this computer.
- **Errors.** Server errors never return stack traces or internal details.

## Known limits
- **Lockout as a nuisance.** A 4–6 digit PIN depends on the lockout. Someone who knows a driver ID can lock that driver out for 15 minutes at a time. For a hard limit, add Vercel Firewall rate limiting on `/api/auth/*`.
- **Per-instance limits.** The per-IP rate limit is counted separately in each serverless instance.
