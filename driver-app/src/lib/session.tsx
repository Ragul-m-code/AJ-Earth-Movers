import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setSessionToken, setUnauthorizedHandler } from "./api";
import { clearAllDrafts } from "./drafts";
import { tokenStore } from "./tokenStore";

type Status = "loading" | "signedOut" | "signedIn";

interface SessionValue {
  status: Status;
  displayName: string | null;
  signIn: (loginId: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Set when the server rejected the stored session, so the login screen can explain why. */
  expiredNotice: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [expiredNotice, setExpiredNotice] = useState(false);

  const forget = useCallback(async () => {
    setSessionToken(null);
    clearAllDrafts();
    await tokenStore.clear().catch(() => undefined);
    setDisplayName(null);
    setStatus("signedOut");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setExpiredNotice(true);
      void forget();
    });
    (async () => {
      const saved = await tokenStore.get().catch(() => null);
      if (!saved) return setStatus("signedOut");
      setSessionToken(saved);
      setStatus("signedIn");
    })();
  }, [forget]);

  const signIn = useCallback(async (loginId: string, pin: string) => {
    const res = await api.login(loginId, pin);
    setSessionToken(res.token);
    await tokenStore.set(res.token);
    setDisplayName(res.user.displayName);
    setExpiredNotice(false);
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(async () => {
    // Revoke on the server when reachable; sign out locally regardless.
    await api.logout().catch(() => undefined);
    await forget();
  }, [forget]);

  const value = useMemo(() => ({ status, displayName, signIn, signOut, expiredNotice }), [status, displayName, signIn, signOut, expiredNotice]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
