import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { DateInput, FormSection, Grid, isValidDate, Kpi, Segmented, Select } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, ErrorView, LoadingView, Row, Screen, SectionTitle } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { dateLabel, hours, rupees, shiftMonth, todayIst } from "@/lib/format";
import type { Lookups } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, type } from "@/theme";

interface Preview {
  method: "HOURLY" | "FIXED"; fixedSalary: string | null; approvedHours: string; workingDays: number; gross: string; additions: string; deductions: string; net: string;
  jobs: { code: string; workDate: string; hours: string; rate: string | null; amount: string }[];
  adjustments: { id: string; kind: string; amount: string; description: string }[];
  warnings: string[];
}
const bounds = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return { from: `${m}-01`, to: `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}` };
};

/** Prepare a payroll run from approved, unpaid work (Stitch salary screens; this flow is an addition, see docs). */
export default function NewPayroll() {
  const router = useRouter();
  const lk = useLoad(() => api.get<Lookups>("/lookups"));
  const thisMonth = todayIst().slice(0, 7);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [preset, setPreset] = useState<"last" | "this" | "custom">("last");
  const [custom, setCustom] = useState(bounds(thisMonth));
  const p = preset === "this" ? bounds(thisMonth) : preset === "last" ? bounds(shiftMonth(thisMonth, -1)) : custom;
  const ok = isValidDate(p.from) && isValidDate(p.to) && p.from <= p.to;
  const pv = useLoad(() => (driverId && ok ? api.get<Preview>("/payroll/preview", { driverId, from: p.from, to: p.to }) : Promise.resolve(null)), [driverId, p.from, p.to]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/payroll", { driverId, periodStart: p.from, periodEnd: p.to });
      router.replace({ pathname: "/finance", params: { view: "payroll" } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Payroll was not created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppHeader back title="Prepare payroll" eyebrow="Driver salary" />
      <Screen footer={<Btn variant="accent" icon="save" label={pv.data ? `Create draft · net ${rupees(pv.data.net, { paise: true })}` : "Create draft"} onPress={create} loading={busy} disabled={!pv.data} />}>
        {error && <Banner tone="danger" title="Not created" body={error} />}
        <FormSection step="01" title="Driver & period">
          {lk.data ? <Select label="Driver" required searchable value={driverId} onChange={setDriverId} options={lk.data.drivers.map((d) => ({ value: d.id, label: d.fullName, hint: d.driverCode }))} /> : <LoadingView />}
          <Segmented value={preset} onChange={setPreset} options={[{ value: "last", label: "Last month" }, { value: "this", label: "This month" }, { value: "custom", label: "Custom" }]} />
          {preset === "custom" ? (
            <Grid max={2}>
              <DateInput label="From" value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} quick={false} />
              <DateInput label="To" value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} quick={false} />
            </Grid>
          ) : (
            <Text style={[type.labelLg, { color: color.navy }]}>{dateLabel(p.from)} – {dateLabel(p.to)}</Text>
          )}
          <Text style={[type.bodySm, { color: color.muted }]}>Fixed-salary drivers are paid per full calendar month.</Text>
        </FormSection>
        {driverId && (pv.loading ? <LoadingView /> : pv.error ? <ErrorView error={pv.error} onRetry={pv.reload} /> : pv.data ? (
          <>
            {pv.data.warnings.map((w) => <Banner key={w} tone="warning" title="Excluded" body={w} />)}
            <Grid max={4}>
              <Kpi label="Pay terms" value={pv.data.method === "FIXED" ? "Fixed salary" : "Hourly"} sub={pv.data.method === "FIXED" ? `${rupees(pv.data.fixedSalary!)} / month` : "Each job at its own rate"} />
              <Kpi label="Approved hours" value={hours(pv.data.approvedHours)} sub={`${pv.data.workingDays} working day(s)`} />
              <Kpi label="Gross" value={rupees(pv.data.gross)} />
              <Kpi label="Net payable" value={rupees(pv.data.net)} tone="success" />
            </Grid>
            <SectionTitle icon="calculate">Calculation</SectionTitle>
            <Card>
              <Row label={pv.data.method === "FIXED" ? "Monthly salary" : "Σ approved hours × rate on each work date"} value={rupees(pv.data.gross, { paise: true })} />
              {pv.data.adjustments.map((a) => <Row key={a.id} label={`${a.kind === "ADDITION" ? "+" : "−"} ${a.description}`} value={`${a.kind === "ADDITION" ? "+" : "−"}${rupees(a.amount, { paise: true })}`} />)}
              <View style={{ height: 1, backgroundColor: color.border }} />
              <Row label="Net payable" value={rupees(pv.data.net, { paise: true })} strong />
            </Card>
            <SectionTitle icon="list">Approved work included ({pv.data.jobs.length})</SectionTitle>
            <Card>
              {pv.data.jobs.length === 0 ? <Text style={[type.bodyMd, { color: color.muted }]}>No unpaid approved work in this period.</Text> : pv.data.jobs.map((j) => <Row key={j.code} label={`${dateLabel(j.workDate)} · ${j.code} · ${j.hours} h${j.rate ? ` × ₹${j.rate}` : ""}`} value={pv.data!.method === "FIXED" ? "salary" : rupees(j.amount, { paise: true })} />)}
            </Card>
            <Text style={[type.bodySm, { color: color.muted }]}>Creating the draft locks these work records to this run so they cannot be paid twice. Approve it, then record the payment.</Text>
          </>
        ) : null)}
      </Screen>
    </>
  );
}
