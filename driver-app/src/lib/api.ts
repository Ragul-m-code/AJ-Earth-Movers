import { httpFetch } from "./httpFetch";
import type { Earnings, Me, MonthSummary, NotificationList, Support, WorkOrderDetail, WorkOrderList } from "./types";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const TIMEOUT_MS = 25_000;

/**
 * Outcome categories the UI must treat differently:
 * - "network": the request never reached the server; nothing was saved.
 * - "uncertain": the request may have reached the server but no reply came back (timeout or dropped connection).
 * - "server": the server answered with an error, so its message is authoritative.
 */
export class ApiError extends Error {
  constructor(
    public readonly kind: "network" | "uncertain" | "server",
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const setSessionToken = (t: string | null) => {
  token = t;
};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};
export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

async function request<T>(method: string, path: string, body?: unknown, opts: { formData?: FormData; sendsData?: boolean } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await httpFetch(`${API_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: { ...authHeaders(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: opts.formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    // For a write, a timeout or dropped connection means the server may have processed it.
    const writing = method !== "GET";
    throw writing && controller.signal.aborted
      ? new ApiError("uncertain", 0, "NO_RESPONSE", "No reply from the server. Your submission may or may not have been saved.")
      : new ApiError("network", 0, "NETWORK", "Cannot reach the AJ server. Check your mobile data and try again.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    const err = json?.error;
    throw new ApiError("server", res.status, err?.code ?? "HTTP_" + res.status, err?.message ?? "The server could not process this request.");
  }
  return json as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return s ? `?${s}` : "";
};

export const api = {
  login: (loginId: string, pin: string) =>
    request<{ token: string; user: { id: string; displayName: string } }>("POST", "/api/auth/driver/login", { loginId, pin }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  me: () => request<Me>("GET", "/api/driver/me"),
  workOrders: (params: { group?: string; q?: string; from?: string; to?: string; page?: number; pageSize?: number }) =>
    request<WorkOrderList>("GET", `/api/driver/work-orders${qs(params)}`),
  workOrder: (id: string) => request<WorkOrderDetail>("GET", `/api/driver/work-orders/${id}`),
  accept: (id: string) => request<WorkOrderDetail>("POST", `/api/driver/work-orders/${id}/accept`),
  decline: (id: string, reason: string) => request<WorkOrderDetail>("POST", `/api/driver/work-orders/${id}/decline`, { reason }),
  checkReading: (id: string, kind: "START" | "END", value: string) =>
    request<{ hours: string | null; flags: string[] }>("POST", `/api/driver/work-orders/${id}/readings/check`, { kind, value }),
  submitReading: (id: string, form: FormData) =>
    request<{ replayed: boolean; workOrder: WorkOrderDetail }>("POST", `/api/driver/work-orders/${id}/readings`, undefined, { formData: form }),
  summary: (month: string) => request<MonthSummary>("GET", `/api/driver/summary${qs({ month })}`),
  earnings: () => request<Earnings>("GET", "/api/driver/earnings"),
  notifications: () => request<NotificationList>("GET", "/api/driver/notifications"),
  markRead: (id: string) => request<void>("POST", `/api/driver/notifications/${id}/read`),
  markAllRead: () => request<void>("POST", "/api/driver/notifications/read-all"),
  support: () => request<Support>("GET", "/api/driver/support"),
};
