import { httpFetch } from "./httpFetch";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const TIMEOUT_MS = 25_000;

/**
 * "network": never reached the server, nothing saved. "uncertain": a write may have been processed but no reply arrived.
 * "server": the server answered with an error; its message is authoritative.
 */
export class ApiError extends Error {
  constructor(
    public readonly kind: "network" | "uncertain" | "server",
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;
let onPasswordChange: (() => void) | null = null;
export const setSessionToken = (t: string | null) => {
  token = t;
};
export const setAuthHandlers = (h: { unauthorized: () => void; passwordChange: () => void }) => {
  onUnauthorized = h.unauthorized;
  onPasswordChange = h.passwordChange;
};
export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

type Query = Record<string, string | number | boolean | undefined | null | string[]>;
export const qs = (params: Query = {}) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(",") : String(v))}`)
    .join("&");
  return s ? `?${s}` : "";
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await httpFetch(`${API_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: { ...authHeaders(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw method !== "GET" && controller.signal.aborted
      ? new ApiError("uncertain", 0, "NO_RESPONSE", "No reply from the server. The change may or may not have been saved. Refresh before trying again.")
      : new ApiError("network", 0, "NETWORK", "Cannot reach the AJ server. Check the internet connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error;
    if (res.status === 401 && token) onUnauthorized?.();
    if (res.status === 403 && err?.code === "PASSWORD_CHANGE_REQUIRED") onPasswordChange?.();
    const message =
      res.status === 403 && err?.code === "FORBIDDEN" ? "Your account does not have permission for this. Ask the owner to grant access." : (err?.message ?? "The server could not process this request.");
    throw new ApiError("server", res.status, err?.code ?? `HTTP_${res.status}`, message, err?.details);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", `/api/admin${path}${qs(query)}`),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", `/api/admin${path}`, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", `/api/admin${path}`, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", `/api/admin${path}`, body),
  del: <T>(path: string) => request<T>("DELETE", `/api/admin${path}`),
  login: (identifier: string, password: string) =>
    request<{ token: string; user: { id: string; displayName: string; role: string; mustChangePassword: boolean } }>("POST", "/api/auth/admin/login", { identifier, password }),
  changePassword: (currentPassword: string, newPassword: string) => request<void>("POST", "/api/auth/admin/change-password", { currentPassword, newPassword }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  /** Raw CSV text for report exports. */
  csv: async (path: string, query: Query) => {
    const res = await httpFetch(`${API_URL}/api/admin${path}${qs({ ...query, format: "csv" })}`, { headers: authHeaders() });
    if (!res.ok) throw new ApiError("server", res.status, "EXPORT_FAILED", "The export could not be created.");
    return res.text();
  },
};

export const newKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
