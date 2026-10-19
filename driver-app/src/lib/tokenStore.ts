import * as SecureStore from "expo-secure-store";

// Session token in the device keychain / keystore. Web uses tokenStore.web.ts.
const KEY = "aj.session";

export const tokenStore = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (token: string) => SecureStore.setItemAsync(KEY, token),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
