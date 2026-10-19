import { fetch as expoFetch } from "expo/fetch";

// Native: expo/fetch can send expo-file-system File objects in FormData (see photoUpload.ts).
export const httpFetch = expoFetch as unknown as typeof globalThis.fetch;
