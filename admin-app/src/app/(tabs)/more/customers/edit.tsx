import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { FormSection, Grid, Select, Toggle } from "@/components/kit";
import { AppHeader, Banner, Btn, Field, LoadingView, Screen } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Form { name: string; contactName: string; phone: string; email: string; address: string; gstin: string; stateCode: string; billingCycle: string; paymentTermsDays: string; notes: string; active: boolean }
const EMPTY: Form = { name: "", contactName: "", phone: "", email: "", address: "", gstin: "", stateCode: "", billingCycle: "MONTHLY", paymentTermsDays: "30", notes: "", active: true };
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Add or edit a customer and their billing preferences (addition: no Stitch form existed for this). */
export default function CustomerForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useLoad(() => (id ? api.get<Record<string, unknown>>(`/customers/${id}`) : Promise.resolve(null)), [id]);
  if (existing.loading) return <><AppHeader back title="Customer" /><LoadingView /></>;
  return <CustomerFormBody key={id ?? "new"} id={id} initial={existing.data} />;
}

const toForm = (e: Record<string, unknown> | null): Form =>
  e ? ({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, k === "active" ? e[k] !== false : e[k] === null || e[k] === undefined ? "" : String(e[k])])) } as Form) : EMPTY;

function CustomerFormBody({ id, initial }: { id?: string; initial: Record<string, unknown> | null }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(() => toForm(initial));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Form) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const errs: Partial<Record<keyof Form, string>> = {};
  if (f.name.trim().length < 2) errs.name = "Customer name is required.";
  if (f.gstin && !GSTIN.test(f.gstin.trim().toUpperCase())) errs.gstin = "15-character GSTIN, e.g. 27ABCDE1234F1Z5. Leave blank if unregistered.";
  if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) errs.email = "Enter a valid email.";
  if (!/^\d{1,3}$/.test(f.paymentTermsDays) || Number(f.paymentTermsDays) > 180) errs.paymentTermsDays = "0 to 180 days.";
  const e = (k: keyof Form) => (touched ? errs[k] : undefined);

  const save = async () => {
    setTouched(true);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    const body = {
      name: f.name, contactName: f.contactName || null, phone: f.phone || null, email: f.email || null, address: f.address || null,
      gstin: f.gstin ? f.gstin.trim().toUpperCase() : null, stateCode: f.stateCode || null, billingCycle: f.billingCycle,
      paymentTermsDays: Number(f.paymentTermsDays), notes: f.notes || null, active: f.active,
    };
    try {
      const c = id ? await api.patch<{ id: string }>(`/customers/${id}`, body) : await api.post<{ id: string }>("/customers", body);
      router.replace(`/more/customers/${c.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppHeader back title={id ? "Edit customer" : "Add customer"} eyebrow="Customers" />
      <Screen footer={<Btn variant="accent" icon="save" label="Save customer" onPress={save} loading={busy} />}>
        {error && <Banner tone="danger" title="Not saved" body={error} />}
        <Grid max={2}>
          <FormSection step="01" title="Company & contact">
            <Field label="Customer name" required value={f.name} onChangeText={set("name")} error={e("name")} />
            <Field label="Contact person" value={f.contactName} onChangeText={set("contactName")} />
            <Field label="Phone" value={f.phone} onChangeText={set("phone")} keyboardType="phone-pad" />
            <Field label="Email" value={f.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" error={e("email")} />
            <Field label="Billing address" value={f.address} onChangeText={set("address")} multiline />
          </FormSection>
          <FormSection step="02" title="Billing preferences">
            <Field label="GSTIN" value={f.gstin} onChangeText={set("gstin")} autoCapitalize="characters" maxLength={15} error={e("gstin")} hint="Format check only. Your accountant confirms the tax treatment." />
            <Field label="State code" value={f.stateCode} onChangeText={set("stateCode")} keyboardType="number-pad" maxLength={2} hint="Filled from the GSTIN when blank." />
            <Select label="Invoice period" value={f.billingCycle} onChange={set("billingCycle")} options={[{ value: "PER_WORK_ORDER", label: "Per work order" }, { value: "DAILY", label: "Daily" }, { value: "WEEKLY", label: "Weekly" }, { value: "MONTHLY", label: "Monthly" }, { value: "CUSTOM", label: "Custom (as agreed)" }]} />
            <Field label="Payment terms (days)" value={f.paymentTermsDays} onChangeText={set("paymentTermsDays")} keyboardType="number-pad" error={e("paymentTermsDays")} />
            <Field label="Notes" value={f.notes} onChangeText={set("notes")} multiline />
            {id && <Toggle label="Active customer" value={f.active} onChange={(v) => setF((s) => ({ ...s, active: v }))} hint="Inactive customers cannot get new work orders." />}
          </FormSection>
        </Grid>
      </Screen>
    </>
  );
}
