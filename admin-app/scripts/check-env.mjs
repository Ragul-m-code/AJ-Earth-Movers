// Fails the Vercel build if the API URL is missing or still points at a local machine:
// EXPO_PUBLIC_* values are baked into the static bundle at build time.
const url = process.env.EXPO_PUBLIC_API_URL ?? "";
if (process.env.VERCEL && (!/^https:\/\//.test(url) || /localhost|127\.0\.0\.1/.test(url))) {
  console.error(`EXPO_PUBLIC_API_URL must be the deployed API's https URL (got "${url}"). Set it in the Vercel project settings.`);
  process.exit(1);
}
console.log(`API URL: ${url || "(unset)"}`);
