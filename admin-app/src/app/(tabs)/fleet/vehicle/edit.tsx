import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { DateInput, FormSection, Grid, isMoney, isValidDate, MoneyInput } from "@/components/kit";
import { AppHeader, Banner, Btn, ErrorView, Field, LoadingView, Screen } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { todayIst } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";

interface Form {
  unitCode: string; registrationNo: string; make: string; model: string; category: string; year: string; chassisNo: string; engineNo: string; insuranceExpiry: string; fitnessExpiry: string; notes: string;
}
const EMPTY: Form = { unitCode: "", registrationNo: "", make: "", model: "", category: "", year: "", chassisNo: "", engineNo: "", insuranceExpiry: "", fitnessExpiry: "", notes: "" };

/** Add or edit a machine (Stitch: admin_add_edit_vehicle_form). */
export default function VehicleForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useLoad(() => (id ? api.get<Record<string, unknown>>(`/vehicles/${id}`) : Promise.resolve(null)), [id]);
  const header = <AppHeader back title={id ? "Edit machine" : "Add machine"} eyebrow="Fleet" />;
  if (existing.loading) return <>{header}<LoadingView /></>;
  if (id && !existing.data) return <>{header}<ErrorView error={existing.error!} onRetry={existing.reload} /></>;
  return <VehicleFormBody key={id ?? "new"} id={id} initial={existing.data} />;
}

const toForm = (e: Record<string, unknown> | null): Form =>
  e ? ({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, e[k] === null || e[k] === undefined ? "" : String(e[k])])) } as Form) : EMPTY;

function VehicleFormBody({ id, initial }: { id?: string; initial: Record<string, unknown> | null }) {
  const router = useRouter();
  const { can } = useSession();
  const [f, setF] = useState<Form>(() => toForm(initial));
  const [rate, setRate] = useState("");
  const [rateFrom, setRateFrom] = useState(todayIst());
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const set = (k: keyof Form) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const errs: Partial<Record<keyof Form | "rate", string>> = {};
  if (!f.unitCode.trim()) errs.unitCode = "Unit code is required, e.g. UNIT-08.";
  if (!/^[A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{0,3}[-\s]?\d{1,4}$/i.test(f.registrationNo.trim())) errs.registrationNo = "Use the registration format, e.g. MH-12-AB-1234.";
  if (!f.make.trim()) errs.make = "Required.";
  if (!f.model.trim()) errs.model = "Required.";
  if (!f.category.trim()) errs.category = "Required, e.g. Backhoe loader.";
  if (f.year && !/^\d{4}$/.test(f.year)) errs.year = "Four-digit year.";
  if (f.insuranceExpiry && !isValidDate(f.insuranceExpiry)) errs.insuranceExpiry = "YYYY-MM-DD";
  if (f.fitnessExpiry && !isValidDate(f.fitnessExpiry)) errs.fitnessExpiry = "YYYY-MM-DD";
  if (!id && rate && !isMoney(rate)) errs.rate = "Enter a valid rate.";
  const e = (k: keyof typeof errs) => (touched ? errs[k] : undefined);

  const save = async () => {
    setTouched(true);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    const body = {
      unitCode: f.unitCode, registrationNo: f.registrationNo, make: f.make, model: f.model, category: f.category,
      year: f.year ? Number(f.year) : null, chassisNo: f.chassisNo || null, engineNo: f.engineNo || null,
      insuranceExpiry: f.insuranceExpiry || null, fitnessExpiry: f.fitnessExpiry || null, notes: f.notes || null,
    };
    try {
      const v = id ? await api.patch<{ id: string }>(`/vehicles/${id}`, body) : await api.post<{ id: string }>("/vehicles", { ...body, ...(rate ? { hourlyRate: rate, rateEffectiveFrom: rateFrom } : {}) });
      router.replace(`/fleet/vehicle/${v.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppHeader back title={id ? "Edit machine" : "Add machine"} eyebrow="Fleet" />
      <Screen footer={<Btn variant="accent" icon="save" label={id ? "Save changes" : "Add machine"} onPress={save} loading={busy} />}>
        {error && <Banner tone="danger" title="Not saved" body={error} />}
        <Grid max={2}>
          <FormSection step="01" title="Identity">
            <Field label="Unit code" required value={f.unitCode} onChangeText={set("unitCode")} autoCapitalize="characters" error={e("unitCode")} />
            <Field label="Registration number" required value={f.registrationNo} onChangeText={set("registrationNo")} autoCapitalize="characters" placeholder="MH-12-AB-1234" error={e("registrationNo")} />
            <Field label="Make" required value={f.make} onChangeText={set("make")} placeholder="e.g. JCB, CAT, Tata Hitachi" error={e("make")} />
            <Field label="Model" required value={f.model} onChangeText={set("model")} placeholder="e.g. 3DX Super" error={e("model")} />
            <Field label="Category" required value={f.category} onChangeText={set("category")} placeholder="e.g. Backhoe loader" error={e("category")} hint="Customer rates can be agreed per category." />
          </FormSection>
          <FormSection step="02" title="Specifications & documents">
            <Field label="Year of manufacture" value={f.year} onChangeText={set("year")} keyboardType="number-pad" maxLength={4} error={e("year")} />
            <Field label="Chassis number" value={f.chassisNo} onChangeText={set("chassisNo")} autoCapitalize="characters" />
            <Field label="Engine number" value={f.engineNo} onChangeText={set("engineNo")} autoCapitalize="characters" />
            <DateInput label="Insurance expiry" value={f.insuranceExpiry} onChange={set("insuranceExpiry")} quick={false} error={e("insuranceExpiry")} />
            <DateInput label="Fitness certificate expiry" value={f.fitnessExpiry} onChange={set("fitnessExpiry")} quick={false} error={e("fitnessExpiry")} />
            <Field label="Notes" value={f.notes} onChangeText={set("notes")} multiline />
          </FormSection>
          {!id && can("RATES") && (
            <FormSection step="03" title="Default hourly rate (optional)">
              <MoneyInput label="Hourly rate" value={rate} onChange={setRate} error={e("rate")} hint="Used when a customer has no agreed rate." />
              <DateInput label="Effective from" value={rateFrom} onChange={setRateFrom} quick={false} />
            </FormSection>
          )}
        </Grid>
      </Screen>
    </>
  );
}
