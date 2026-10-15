/**
 * Offline outbox: contract lines and photos are saved on the tablet first and sent when there's signal
 * (dorm basements). Commands carry client-generated ids, so the server ignores duplicates on retry.
 */
import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";
import type { TRPCClient } from "@trpc/client";
import type { AppRouter } from "@css/api";
import type { Pairing } from "./pairing";

export interface PendingItem {
  jobId: string;
  clientId: string;
  rateCardItemId: string | null;
  description: string | null;
  quantity: number;
  preExistingDamage: string | null;
  /** For display while offline. */
  label: string;
}

export type Command =
  | { id: string; kind: "saveItem"; item: PendingItem }
  | { id: string; kind: "photo"; jobId: string; clientId: string; uri: string; photoKind: "item" | "delivery" | "signature" | "room"; itemClientId: string | null };

const KEY = "css.outbox";
let queue: Command[] = (() => {
  try {
    return JSON.parse(Storage.getItemSync(KEY) ?? "[]") as Command[];
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();
let flushing = false;
let lastError: string | null = null;

function persist() {
  Storage.setItemSync(KEY, JSON.stringify(queue));
  listeners.forEach((l) => l());
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

export function enqueue(cmd: Command) {
  queue = [...queue, cmd];
  persist();
}

export function useOutbox() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => queue,
  );
}

export function outboxError() {
  return lastError;
}

async function uploadPhoto(pairing: Pairing, cmd: Extract<Command, { kind: "photo" }>) {
  const form = new FormData();
  form.append("jobId", cmd.jobId);
  form.append("kind", cmd.photoKind);
  form.append("clientId", cmd.clientId);
  if (cmd.itemClientId) form.append("itemClientId", cmd.itemClientId);
  // React Native's FormData accepts a { uri, name, type } file descriptor.
  form.append("file", { uri: cmd.uri, name: `${cmd.clientId}.jpg`, type: "image/jpeg" } as unknown as Blob);
  const res = await fetch(`${pairing.apiUrl}/crew/photos`, { method: "POST", headers: { authorization: `Bearer ${pairing.token}` }, body: form });
  if (res.status >= 500 || res.status === 0) throw new Error(`upload failed (${res.status})`);
  if (!res.ok) console.warn("photo rejected", res.status, await res.text());
}

/** Sends queued commands in order. Stops at the first network failure and tries again later. */
export async function flush(client: TRPCClient<AppRouter>, pairing: Pairing): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      const cmd = queue[0]!;
      if (cmd.kind === "saveItem") {
        const { label: _label, ...item } = cmd.item;
        await client.crew.saveItem.mutate(item);
      } else {
        await uploadPhoto(pairing, cmd);
      }
      queue = queue.slice(1);
      lastError = null;
      persist();
    }
  } catch (err) {
    lastError = (err as Error).message;
    listeners.forEach((l) => l());
  } finally {
    flushing = false;
  }
}

export function removePending(clientId: string) {
  queue = queue.filter((c) => !(c.kind === "saveItem" && c.item.clientId === clientId) && !(c.kind === "photo" && c.itemClientId === clientId));
  persist();
}
