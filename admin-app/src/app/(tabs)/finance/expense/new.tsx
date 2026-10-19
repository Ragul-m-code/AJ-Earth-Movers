import { useRouter } from "expo-router";
import { useState } from "react";
import { DateInput, FormSection, isMoney, isValidDate, MoneyInput, Select } from "@/components/kit";
import { AppHeader, Banner, Btn, Field, LoadingView, Screen } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { todayIst } from "@/lib/format";
import type { Lookups } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";

const CATEGORIES = ["Fuel (HSD)", "Repairs & spares", "Tyres", "Insurance", "Permits & taxes", "Transport", "Driver allowance", "Office", "Other"];

/** Record a business expense (Stitch: admin_expenses). */
export default function NewExpense() {
  const router = useRouter();
  const lk = useLoad(() => api.get<Lookups>("/lookups"));
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [vehicleId, setVehicleId] = useState<string>("__none");
  const [spentOn, setSpentOn] = useState(todayIst());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = isMoney(amount) && Number(amount) > 0 && isValidDate(spentOn) && description.trim().length >= 3;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/expenses", { category, vehicleId: vehicleId === "__none" ? null : vehicleId, spentOn, amount, description: description.trim(), vendor: vendor || undefined, reference: reference || undefined });
      router.replace({ pathname: "/finance", params: { view: "expenses" } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppHeader back title="Record expense" eyebrow="Finance" />
      <Screen footer={<Btn variant="accent" icon="save" label="Save expense" onPress={save} loading={busy} disabled={!valid} />}>
        {error && <Banner tone="danger" title="Not saved" body={error} />}
        <FormSection title="Expense">
          <Select label="Category" value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          {lk.data ? <Select label="Machine (optional)" searchable value={vehicleId} onChange={setVehicleId} options={[{ value: "__none", label: "Not for a specific machine" }, ...lk.data.vehicles.map((v) => ({ value: v.id, label: `${v.unitCode} · ${v.make} ${v.model}` }))]} /> : <LoadingView />}
          <DateInput label="Date" required value={spentOn} onChange={setSpentOn} />
          <MoneyInput label="Amount" required value={amount} onChange={setAmount} />
          <Field label="Description" required value={description} onChangeText={setDescription} placeholder="e.g. 45 L HSD for UNIT-08" />
          <Field label="Vendor" value={vendor} onChangeText={setVendor} />
          <Field label="Bill / reference no." value={reference} onChangeText={setReference} />
        </FormSection>
      </Screen>
    </>
  );
}
