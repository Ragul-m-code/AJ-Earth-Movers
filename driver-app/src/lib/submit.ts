import { api, ApiError } from "./api";
import { getDraft, updateDraft } from "./drafts";
import { appendPhoto } from "./photoUpload";
import type { MeterKind, WorkOrderDetail } from "./types";

export type SubmitOutcome =
  | { ok: true; workOrder: WorkOrderDetail; replayed: boolean }
  | { ok: false; kind: "network" | "uncertain" | "server"; message: string; code: string };

/**
 * Sends the in-memory draft. Success is reported only when the server confirms it.
 * The same idempotency key is reused on retry, so a retry after an unconfirmed send can never record twice.
 */
export async function submitDraft(workOrderId: string, kind: MeterKind): Promise<SubmitOutcome> {
  const draft = getDraft(workOrderId, kind);
  if (!draft.photo) return { ok: false, kind: "server", code: "PHOTO_REQUIRED", message: "Take a photo of the meter first." };
  updateDraft(workOrderId, kind, { sendState: "sending", lastError: null });

  try {
    const form = new FormData();
    form.append("kind", kind);
    form.append("value", draft.value.trim());
    form.append("idempotencyKey", draft.idempotencyKey);
    if (draft.note.trim()) form.append("note", draft.note.trim());
    await appendPhoto(form, draft.photo.uri);

    const res = await api.submitReading(workOrderId, form);
    return { ok: true, workOrder: res.workOrder, replayed: res.replayed };
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError("network", 0, "UNKNOWN", "The photo could not be prepared. Retake it and try again.");
    // A server-side 5xx after the request arrived could also be ambiguous, so treat it as unconfirmed.
    const kindOf = err.kind === "server" && err.status >= 500 ? "uncertain" : err.kind;
    updateDraft(workOrderId, kind, { sendState: kindOf === "uncertain" ? "uncertain" : "failed", lastError: err.message });
    return { ok: false, kind: kindOf, message: err.message, code: err.code };
  }
}
