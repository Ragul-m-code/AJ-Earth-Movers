import type { Draft } from "@/lib/drafts";
import { Banner } from "./ui";

/** Honest status for a send attempt: nothing is called "saved" until the server confirms it. */
export function SubmitStatus({ draft }: { draft: Draft }) {
  if (draft.sendState === "uncertain") {
    return (
      <Banner
        tone="warning"
        icon="sync-problem"
        title="Not confirmed yet"
        body="The upload may or may not have reached the server. Tap Retry: it is safe and cannot create a duplicate. Do not change the reading until it is confirmed."
      />
    );
  }
  if (draft.sendState === "failed") {
    return <Banner tone="danger" icon="cloud-off" title="Not submitted, nothing was saved" body={draft.lastError ?? "Check your connection and try again."} />;
  }
  return null;
}
