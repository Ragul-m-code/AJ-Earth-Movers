import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { FormSection, Toggle } from "@/components/kit";
import { AppHeader, Banner, Btn, Field, LoadingView, Screen } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Existing { code: string; name: string; type: string; chargeable: boolean; active: boolean; notes: string | null }

export default function AttachmentForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useLoad(() => (id ? api.get<Existing>(`/attachments/${id}`) : Promise.resolve(null)), [id]);
  if (existing.loading) return <><AppHeader back title="Attachment" /><LoadingView /></>;
  return <AttachmentFormBody key={id ?? "new"} id={id} initial={existing.data} />;
}

function AttachmentFormBody({ id, initial }: { id?: string; initial: Existing | null }) {
  const router = useRouter();
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState(initial?.type ?? "");
  const [chargeable, setChargeable] = useState(initial?.chargeable ?? true);
  const [active, setActive] = useState(initial?.active ?? true);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);


  const missing = !code.trim() || !name.trim() || !kind.trim();
  const save = async () => {
    setTouched(true);
    if (missing) return;
    setBusy(true);
    setError(null);
    try {
      const body = { code, name, type: kind, chargeable, active, notes: notes || null };
      const a = id ? await api.patch<{ id: string }>(`/attachments/${id}`, body) : await api.post<{ id: string }>("/attachments", body);
      router.replace(`/fleet/attachment/${a.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppHeader back title={id ? "Edit attachment" : "Add attachment"} eyebrow="Fleet" />
      <Screen footer={<Btn variant="accent" icon="save" label="Save" onPress={save} loading={busy} />}>
        {error && <Banner tone="danger" title="Not saved" body={error} />}
        <FormSection title="Attachment">
          <Field label="Code" required value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="e.g. BRK-01" error={touched && !code.trim() ? "Required." : null} />
          <Field label="Name" required value={name} onChangeText={setName} placeholder="e.g. JCB HM380 Hydraulic Breaker" error={touched && !name.trim() ? "Required." : null} />
          <Field label="Type" required value={kind} onChangeText={setKind} placeholder="Breaker, Bucket, Auger…" error={touched && !kind.trim() ? "Required." : null} />
          <Toggle label="Billable surcharge" value={chargeable} onChange={setChargeable} hint="Adds an hourly surcharge on approved breaker hours, on top of the machine rate." />
          {id && <Toggle label="Active" value={active} onChange={setActive} hint="Inactive attachments cannot be added to new jobs." />}
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
        </FormSection>
      </Screen>
    </>
  );
}
