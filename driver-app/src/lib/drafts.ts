import * as Crypto from "expo-crypto";
import { useSyncExternalStore } from "react";
import type { MeterKind } from "./types";

/**
 * In-progress meter reading for one job, held in memory only.
 * Offline recording is not supported, so nothing is written to the device: a draft is lost if the app closes,
 * and the reading only counts once the server confirms it.
 */
export interface PhotoCapture {
  uri: string;
  width: number;
  height: number;
  capturedAt: string;
}

export interface Draft {
  value: string;
  note: string;
  photo: PhotoCapture | null;
  /** Reused across retries of the same value and photo so the server never records it twice. */
  idempotencyKey: string;
  /** "uncertain" = sent, but no confirmation came back. Retrying is safe because of the key. */
  sendState: "idle" | "sending" | "failed" | "uncertain";
  lastError: string | null;
}

const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
const keyOf = (workOrderId: string, kind: MeterKind) => `${workOrderId}:${kind}`;
const emit = () => listeners.forEach((l) => l());

const blank = (): Draft => ({ value: "", note: "", photo: null, idempotencyKey: Crypto.randomUUID(), sendState: "idle", lastError: null });

export function getDraft(workOrderId: string, kind: MeterKind): Draft {
  const k = keyOf(workOrderId, kind);
  let d = drafts.get(k);
  if (!d) drafts.set(k, (d = blank()));
  return d;
}

export function updateDraft(workOrderId: string, kind: MeterKind, patch: Partial<Draft>) {
  const current = getDraft(workOrderId, kind);
  const payloadChanged =
    (patch.value !== undefined && patch.value !== current.value) ||
    (patch.photo !== undefined && patch.photo?.uri !== current.photo?.uri) ||
    (patch.note !== undefined && patch.note !== current.note);
  // A different value or photo is a different submission, so it needs a fresh key.
  // While a send is unconfirmed, changes are blocked in the UI so the key is never reused for other data.
  const next: Draft = { ...current, ...patch };
  if (payloadChanged && current.sendState !== "uncertain") next.idempotencyKey = Crypto.randomUUID();
  drafts.set(keyOf(workOrderId, kind), next);
  emit();
}

export function clearDraft(workOrderId: string, kind: MeterKind) {
  drafts.delete(keyOf(workOrderId, kind));
  emit();
}

export function clearAllDrafts() {
  drafts.clear();
  emit();
}

export function useDraft(workOrderId: string, kind: MeterKind): Draft {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => getDraft(workOrderId, kind),
  );
}
