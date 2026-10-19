import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { DateInput, Grid, isValidDate, Kpi, Segmented, useFlash } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, Chips, EmptyView, ErrorView, LoadingView, Row, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { hours, rupees, shiftMonth, todayIst } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

type Kind = "operating-hours" | "utilization" | "billing" | "outstanding" | "driver-earnings";
type Rows = Record<string, string | number | null>[];
interface Report { rows: Rows; note?: string; totalHours?: string; buckets?: Record<string, string>; total?: string; days?: number }

const bounds = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return { from: `${m}-01`, to: `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}` };
};

/** Reports with filters and CSV export. Every report states what its numbers mean. */
export default function Reports() {
  const { can } = useSession();
  const flash = useFlash();
  const kinds: { value: Kind; label: string }[] = [
    { value: "operating-hours", label: "Operating hours" },
    { value: "utilization", label: "Utilization" },
    ...(can("INVOICES") ? [{ value: "billing" as const, label: "Customer billing" }, { value: "outstanding" as const, label: "Outstanding" }] : []),
    ...(can("PAYROLL") ? [{ value: "driver-earnings" as const, label: "Driver earnings" }] : []),
  ];
  const [kind, setKind] = useState<Kind>("operating-hours");
  const [groupBy, setGroupBy] = useState<"vehicle" | "driver" | "customer">("vehicle");
  const thisMonth = todayIst().slice(0, 7);
  const [preset, setPreset] = useState<"this" | "last" | "custom">("this");
  const [custom, setCustom] = useState(bounds(thisMonth));
  const r = preset === "this" ? bounds(thisMonth) : preset === "last" ? bounds(shiftMonth(thisMonth, -1)) : custom;
  const ok = isValidDate(r.from) && isValidDate(r.to) && r.from <= r.to;
  const q = useLoad(() => (ok ? api.get<Report>(`/reports/${kind}`, { from: r.from, to: r.to, groupBy }) : Promise.resolve(null)), [kind, r.from, r.to, groupBy]);
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = await api.csv(`/reports/${kind}`, { from: r.from, to: r.to, groupBy });
      const name = `aj-${kind}-${r.from}-to-${r.to}.csv`;
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const file = new File(Paths.cache, name);
        file.create({ overwrite: true });
        file.write(csv);
        await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: name });
      }
    } catch (e) {
      flash.fail(e, "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <AppHeader back title="Reports" eyebrow="Analytics & exports" />
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        {flash.node}
        <Chips value={kind} onChange={setKind} options={kinds} />
        {kind !== "outstanding" && (
          <>
            <Segmented value={preset} onChange={setPreset} options={[{ value: "this", label: "This month" }, { value: "last", label: "Last month" }, { value: "custom", label: "Custom" }]} />
            {preset === "custom" && (
              <View style={{ flexDirection: "row", gap: space.md }}>
                <View style={{ flex: 1 }}><DateInput label="From" value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} quick={false} /></View>
                <View style={{ flex: 1 }}><DateInput label="To" value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} quick={false} /></View>
              </View>
            )}
          </>
        )}
        {kind === "operating-hours" && <Segmented value={groupBy} onChange={setGroupBy} options={[{ value: "vehicle", label: "By machine" }, { value: "driver", label: "By driver" }, { value: "customer", label: "By customer" }]} />}
        <Btn variant="outline" icon="download" label="Export CSV" onPress={exportCsv} loading={exporting} disabled={!q.data || q.data.rows.length === 0} />
        {q.loading ? (
          <LoadingView />
        ) : q.error ? (
          <ErrorView error={q.error} onRetry={q.reload} />
        ) : q.data ? (
          <>
            {q.data.note && <Banner tone="info" title="What these figures mean" body={q.data.note} />}
            {kind === "operating-hours" && q.data.totalHours && <Kpi label="Total approved hours" value={hours(q.data.totalHours)} />}
            {kind === "outstanding" && q.data.buckets && (
              <Grid max={5}>
                <Kpi label="Not yet due" value={rupees(q.data.buckets.current!)} />
                <Kpi label="1–30 days" value={rupees(q.data.buckets.d1_30!)} tone="warning" />
                <Kpi label="31–60 days" value={rupees(q.data.buckets.d31_60!)} tone="warning" />
                <Kpi label="61–90 days" value={rupees(q.data.buckets.d61_90!)} tone="danger" />
                <Kpi label="90+ days" value={rupees(q.data.buckets.d90plus!)} tone="danger" />
              </Grid>
            )}
            {q.data.rows.length === 0 ? <EmptyView icon="insert-chart-outlined" title="No data for this period" /> : <ReportRows kind={kind} rows={q.data.rows} />}
          </>
        ) : null}
      </Screen>
    </>
  );
}

function ReportRows({ kind, rows }: { kind: Kind; rows: Rows }) {
  return (
    <Grid max={2}>
      {rows.map((r, i) => (
        <Card key={i}>
          {kind === "operating-hours" && (
            <>
              <Text style={[type.labelLg, { color: color.ink }]}>{r.label}</Text>
              <Row label="Approved hours" value={hours(String(r.approvedHours))} strong />
              <Row label="Breaker hours" value={hours(String(r.breakerHours))} />
              <Row label="Jobs · working days" value={`${r.jobs} · ${r.workingDays}`} />
            </>
          )}
          {kind === "utilization" && (
            <>
              <Text style={[type.labelLg, { color: color.ink }]}>{r.unitCode} · {r.model}</Text>
              <Row label="Days with approved work" value={`${r.activeDays} of ${r.availableDays} available`} strong />
              <Row label="Utilization" value={r.utilizationPct === null ? "—" : `${r.utilizationPct}%`} />
              <Row label="Maintenance days" value={String(r.maintenanceDays)} />
              <Row label="Approved hours" value={hours(String(r.approvedHours))} />
            </>
          )}
          {kind === "billing" && (
            <>
              <Text style={[type.labelLg, { color: color.ink }]}>{r.name}</Text>
              <Row label="Invoiced (incl. tax)" value={rupees(String(r.invoicedTotal))} strong />
              <Row label="Collected" value={rupees(String(r.collected))} />
              <Row label="Outstanding today" value={rupees(String(r.outstanding))} />
              <Row label="Approved, not invoiced" value={`${r.unbilledHours} h (${r.unbilledJobs} job(s))`} />
            </>
          )}
          {kind === "outstanding" && (
            <>
              <Text style={[type.labelLg, { color: color.ink }]}>{r.number} · {r.customer}</Text>
              <Row label="Balance" value={rupees(String(r.balance))} strong />
              <Row label="Due" value={`${r.dueDate}${Number(r.daysOverdue) > 0 ? ` · ${r.daysOverdue} days overdue` : ""}`} />
            </>
          )}
          {kind === "driver-earnings" && (
            <>
              <Text style={[type.labelLg, { color: color.ink }]}>{r.name}</Text>
              <Row label="Approved hours · working days" value={`${r.approvedHours} h · ${r.workingDays}`} strong />
              <Row label="Hourly earnings (approved)" value={rupees(String(r.hourlyEarnings))} />
              <Row label="Salary paid in period" value={rupees(String(r.salaryPaid))} />
            </>
          )}
        </Card>
      ))}
    </Grid>
  );
}
