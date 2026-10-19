import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { DateInput, FormSection, isMoney, isValidDate, MoneyInput, Segmented, useFlash } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, ErrorView, Field, LoadingView, Screen, SectionTitle } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { dateLabel, rupees, todayIst } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

interface Profile { fullName: string; driverCode: string; compensation: { method: string; hourlyRate: string | null; monthlySalary: string | null; effectiveFrom: string; note: string | null }[] | null }

/** Driver pay terms with full history (Stitch: admin_driver_salary_settings). */
export default function DriverSalary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const flash = useFlash();
  const q = useLoad(() => api.get<Profile>(`/drivers/${id}`), [id]);
  const [method, setMethod] = useState<"HOURLY" | "FIXED">("HOURLY");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(todayIst());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = isMoney(amount) && Number(amount) > 0 && isValidDate(from) && note.trim().length >= 5;

  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/drivers/${id}/compensation`, { method, ...(method === "HOURLY" ? { hourlyRate: amount } : { monthlySalary: amount }), effectiveFrom: from, note: note.trim() });
      setAmount("");
      setNote("");
      flash.ok("Pay terms saved", "They apply to work on or after the effective date.");
      await q.refresh();
    } catch (e) {
      flash.fail(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  };

  if (q.loading) return <><AppHeader back title="Pay terms" /><LoadingView /></>;
  if (!q.data) return <><AppHeader back title="Pay terms" /><ErrorView error={q.error!} onRetry={q.reload} /></>;
  const history = q.data.compensation ?? [];
  return (
    <>
      <AppHeader back title="Pay terms" eyebrow={`${q.data.fullName} · ${q.data.driverCode}`} />
      <Screen footer={<Btn variant="accent" icon="verified-user" label="Authorize & save pay terms" onPress={save} loading={busy} disabled={!valid} />}>
        {flash.node}
        <Banner tone="info" title="How driver pay works" body="Hourly: each approved job pays approved hours × the rate in force on its work date. Fixed: a monthly salary, whatever the hours. Authorized additions and deductions apply in payroll. Customer billing rates are separate." />
        <FormSection step="01" title="New pay terms">
          <Segmented value={method} onChange={setMethod} options={[{ value: "HOURLY", label: "Hourly" }, { value: "FIXED", label: "Fixed monthly" }]} />
          <MoneyInput label={method === "HOURLY" ? "Rate per approved hour" : "Monthly salary"} required value={amount} onChange={setAmount} />
          <DateInput label="Effective from" required value={from} onChange={setFrom} quick={false} />
          <Field label="Reason (recorded in the audit trail)" required value={note} onChangeText={setNote} multiline placeholder="e.g. Annual revision approved by owner" />
          <Text style={[type.bodySm, { color: color.muted }]}>Cannot be back-dated over payroll that has already been prepared. Earlier work keeps its original rate.</Text>
        </FormSection>
        <SectionTitle icon="history">History</SectionTitle>
        {history.length === 0 ? (
          <Banner tone="warning" title="No pay terms yet" />
        ) : (
          history.map((c, i) => (
            <Card key={c.effectiveFrom} accent={i === 0 ? color.accent : color.borderStrong}>
              <View style={{ paddingLeft: 6, gap: 2 }}>
                <Text style={[type.labelLg, { color: color.ink }]}>{c.method === "HOURLY" ? `${rupees(c.hourlyRate!, { paise: true })} per approved hour` : `${rupees(c.monthlySalary!)} per month (fixed)`}</Text>
                <Text style={[type.bodySm, { color: color.muted }]}>From {dateLabel(c.effectiveFrom)}{c.note ? ` · ${c.note}` : ""}</Text>
              </View>
            </Card>
          ))
        )}
        <View style={{ height: space.md }} />
      </Screen>
    </>
  );
}
