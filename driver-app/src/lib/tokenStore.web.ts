// expo-secure-store has no web support. The web build is for development previews only,
// so the token lives in sessionStorage and disappears when the tab closes.
const KEY = "aj.session";

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const tokenStore = {
  get: async () => safe(() => sessionStorage.getItem(KEY), null),
  set: async (token: string) => safe(() => sessionStorage.setItem(KEY, token), undefined),
  clear: async () => safe(() => sessionStorage.removeItem(KEY), undefined),
};
