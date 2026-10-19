import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { DateInput, FormSection, isMoney, isValidDate, MoneyInput, Select } from "@/components/kit";
import { AppHeader, Banner, Btn, ErrorView, Field, LoadingView, Screen } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Lookups } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";

const CATEGORIES = ["Preventive service", "Breakdown repair", "Tyres & tracks", "Hydraulics", "Engine", "Electrical", "Inspection", "Other"];

/** Add a maintenance record (Stitch: admin_add_maintenance_record). */
export default function NewMaintenance() {
  const params = useLocalSearchParams<{ vehicleId?: string }>();
  const router = useRouter();
  const lk = useLoad(() => api.get<Lookups>("/lookups"));
  const [vehicleId, setVehicleId] = useState<string | null>(params.vehicleId ?? null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [scheduledOn, setScheduledOn] = useState("");
  const [meterReading, setMeterReading] = useState("");
  const [vendor, setVendor] = useState("");
  const [cost, setCost] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errs = {
    vehicle: !vehicleId ? "Choose the machine." : null,
    title: title.trim().length < 2 ? "Describe the work." : null,
    date: scheduledOn && !isValidDate(scheduledOn) ? "YYYY-MM-DD" : null,
    meter: meterReading && !/^\d{1,7}(\.\d)?$/.test(meterReading) ? "Hours with at most one decimal." : null,
    cost: cost && !isMoney(cost) ? "Enter a valid amount." : null,
  };
  const save = async () => {
    setTouched(true);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/maintenance", { vehicleId, title, category, description: description || null, scheduledOn: scheduledOn || null, meterReading: meterReading || null, vendor: vendor || null, cost: cost || null });
      router.replace({ pathname: "/fleet", params: { view: "maintenance" } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  };

  if (lk.loading) return <><AppHeader back title="Add maintenance" /><LoadingView /></>;
  if (!lk.data) return <><AppHeader back title="Add maintenance" /><ErrorView error={lk.error!} onRetry={lk.reload} /></>;
  const t = (k: keyof typeof errs) => (touched ? errs[k] : null);
  return (
    <>
      <AppHeader back title="Add maintenance" eyebrow="Fleet" />
      <Screen footer={<Btn variant="accent" icon="save" label="Save record" onPress={save} loading={busy} />}>
        {error && <Banner tone="danger" title="Not saved" body={error} />}
        <FormSection title="Maintenance">
          <Select label="Machine" required searchable value={vehicleId} onChange={setVehicleId} options={lk.data.vehicles.map((v) => ({ value: v.id, label: `${v.unitCode} · ${v.make} ${v.model}`, hint: v.registrationNo }))} error={t("vehicle")} />
          <Field label="Title" required value={title} onChangeText={setTitle} placeholder="e.g. 500-hour service" error={t("title")} />
          <Select label="Category" value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          <DateInput label="Scheduled date" value={scheduledOn} onChange={setScheduledOn} error={t("date")} />
          <Field label="Meter reading (hours)" value={meterReading} onChangeText={setMeterReading} keyboardType="decimal-pad" error={t("meter")} />
          <Field label="Vendor / workshop" value={vendor} onChangeText={setVendor} />
          <MoneyInput label="Estimated or actual cost" value={cost} onChange={setCost} error={t("cost")} />
          <Field label="Description" value={description} onChangeText={setDescription} multiline />
        </FormSection>
        <Banner tone="info" title="Workshop status" body="Scheduling does not block the machine. Starting the maintenance moves it to Maintenance, which is only allowed when it has no open jobs." />
      </Screen>
    </>
  );
}
