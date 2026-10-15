/** The tablet's pairing: which API to talk to and its device token (stored in the OS keystore). */
import * as SecureStore from "expo-secure-store";

export interface Pairing {
  apiUrl: string;
  token: string;
}

const KEY = "css.pairing";

export async function loadPairing(): Promise<Pairing | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Pairing) : null;
}

export async function savePairing(p: Pairing): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify({ apiUrl: p.apiUrl.replace(/\/+$/, ""), token: p.token.trim() }));
}

export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
