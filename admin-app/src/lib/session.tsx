import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, setAuthHandlers, setSessionToken } from "./api";
import { tokenStore } from "./tokenStore";

export type Module =
  | "DASHBOARD" | "WORK_ORDERS" | "METER_APPROVAL" | "METER_CORRECTION" | "FLEET" | "MAINTENANCE" | "CUSTOMERS" | "RATES"
  | "INVOICES" | "PAYMENTS" | "DRIVERS" | "PAYROLL" | "EXPENSES" | "REPORTS" | "USERS" | "SETTINGS" | "TAX_VERIFY";

export interface AdminUser {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: "OWNER" | "MANAGER" | "ACCOUNTS";
  permissions: Module[];
  mustChangePassword: boolean;
}

type Status = "loading" | "unreachable" | "signedOut" | "mustChangePassword" | "signedIn";

interface SessionValue {
  status: Status;
  user: AdminUser | null;
  can: (m: Module) => boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Re-checks a saved session after the server could not be reached at start-up. */
  retryStart: () => void;
  notice: string | null;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const forget = useCallback(async (msg?: string) => {
    setSessionToken(null);
    await tokenStore.clear().catch(() => undefined);
    setUser(null);
    setNotice(msg ?? null);
    setStatus("signedOut");
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await api.get<AdminUser>("/me");
    setUser(me);
    setStatus(me.mustChangePassword ? "mustChangePassword" : "signedIn");
  }, []);

  // Checks a saved session. A network failure keeps the session and shows a retry screen instead of the sign-in page;
  // an expired or revoked session is cleared by the unauthorized handler.
  const resume = useCallback(async () => {
    try {
      await refreshUser();
    } catch (e) {
      if (e instanceof ApiError && e.kind === "network") setStatus("unreachable");
      else setStatus((s) => (s === "loading" || s === "unreachable" ? "signedOut" : s));
    }
  }, [refreshUser]);
  const retryStart = useCallback(() => {
    setStatus("loading");
    void resume();
  }, [resume]);

  useEffect(() => {
    setAuthHandlers({
      unauthorized: () => void forget("Your session ended. Sign in again."),
      passwordChange: () => setStatus("mustChangePassword"),
    });
    (async () => {
      const saved = await tokenStore.get().catch(() => null);
      if (!saved) return setStatus("signedOut");
      setSessionToken(saved);
      await resume();
    })();
  }, [forget, resume]);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const res = await api.login(identifier, password);
      setSessionToken(res.token);
      await tokenStore.set(res.token);
      setNotice(null);
      await refreshUser();
    },
    [refreshUser],
  );

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    await forget();
  }, [forget]);

  const value = useMemo<SessionValue>(
    () => ({ status, user, can: (m) => !!user?.permissions.includes(m), signIn, signOut, refreshUser, retryStart, notice }),
    [status, user, signIn, signOut, refreshUser, retryStart, notice],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}
