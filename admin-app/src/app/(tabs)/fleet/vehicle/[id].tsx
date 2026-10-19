import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { ConfirmDialog, DateInput, Grid, InfoGrid, isMoney, isValidDate, Kpi, ListRow, MoneyInput, Select, StatusBadge, useFlash } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, ErrorView, LoadingView, Row, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, daysFromToday, hours, meter, rupees, todayIst } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

interface VehicleDetail {
  id: string; unitCode: string; registrationNo: string; make: string; model: string; category: string; year: number | null; chassisNo: string | null; engineNo: string | null;
  insuranceExpiry: string | null; fitnessExpiry: string | null; notes: string | null; storedStatus: string; status: string; lastApprovedMeter: string | null;
  rates: { id: string; hourlyRate: string; effectiveFrom: string }[];
  upcoming: { id: string; code: string; status: string; workDate: string; siteName: string; driverName: string; customerName: string }[];
  maintenance: { id: string; title: string; category: string; status: string; scheduledOn: string | null; completedAt: string | null; cost: string | null }[];
  stats: { approvedHours30d: string; jobs30d: number; approvedHoursLifetime: string; jobsLifetime: number; expensesTotal: string };
}

export default function VehicleDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const flash = useFlash();
  const q = useLoad(() => api.get<VehicleDetail>(`/vehicles/${id}`), [id]);
  const [statusOpen, setStatusOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("AVAILABLE");
  const [rateOpen, setRateOpen] = useState(false);
  const [rate, setRate] = useState("");
  const [rateFrom, setRateFrom] = useState(todayIst());

  const header = <AppHeader back title={q.data ? `${q.data.unitCode} · ${q.data.model}` : "Machine"} eyebrow="Machine details" />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const v = q.data;
  const soon = daysFromToday(30);
  const expiring = (d: string | null) => d && d <= soon;

  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        {flash.node}
        <View style={{ backgroundColor: color.navy, borderRadius: radius.xl, padding: space.lg, gap: space.sm }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={[type.labelSm, { color: color.accent }]}>{v.unitCode} · {v.category}</Text>
            <StatusBadge status={v.status} />
          </View>
          <Text style={[type.displaySm, { color: color.white }]}>{v.make} {v.model}</Text>
          <View style={{ alignSelf: "flex-start", backgroundColor: color.white, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 2, borderColor: color.accent }}>
            <Text style={{ fontFamily: font.extrabold, fontSize: 18, color: color.ink, letterSpacing: 1 }}>{v.registrationNo}</Text>
          </View>
        </View>
        {(expiring(v.insuranceExpiry) || expiring(v.fitnessExpiry)) && <Banner tone="warning" title="Document renewal due" body={[expiring(v.insuranceExpiry) && `Insurance ${dateLabel(v.insuranceExpiry!)}`, expiring(v.fitnessExpiry) && `Fitness ${dateLabel(v.fitnessExpiry!)}`].filter(Boolean).join(" · ")} />}
        <Grid max={4}>
          <Kpi label="Last approved meter" value={v.lastApprovedMeter ? meter(v.lastApprovedMeter) : "—"} sub="hours" />
          <Kpi label="Approved, 30 days" value={hours(v.stats.approvedHours30d)} sub={`${v.stats.jobs30d} job(s)`} />
          <Kpi label="Lifetime" value={hours(v.stats.approvedHoursLifetime)} sub={`${v.stats.jobsLifetime} job(s)`} />
          <Kpi label="Expenses recorded" value={rupees(v.stats.expensesTotal)} />
        </Grid>
        <Grid max={3}>
          <Btn variant="outline" icon="edit" label="Edit details" onPress={() => router.push({ pathname: "/fleet/vehicle/edit", params: { id: v.id } })} />
          <Btn variant="outline" icon="speed" label="Meter history" onPress={() => router.push(`/fleet/vehicle/meter/${v.id}`)} />
          <Btn variant="outline" icon="toggle-on" label="Change status" onPress={() => { setNewStatus(v.storedStatus); setStatusOpen(true); }} />
        </Grid>

        <Grid max={2}>
          <View style={{ gap: space.md }}>
            <SectionTitle icon="description">Specifications</SectionTitle>
            <Card>
              <InfoGrid items={[["Year", v.year ? String(v.year) : null], ["Chassis no.", v.chassisNo], ["Engine no.", v.engineNo], ["Insurance expiry", v.insuranceExpiry && dateLabel(v.insuranceExpiry)], ["Fitness expiry", v.fitnessExpiry && dateLabel(v.fitnessExpiry)], ["Notes", v.notes]]} />
            </Card>
            <SectionTitle icon="currency-rupee" right={can("RATES") ? <Btn compact variant="ghost" label="Add rate" onPress={() => setRateOpen(true)} /> : undefined}>Default hourly rate</SectionTitle>
            <Card>
              {v.rates.length === 0 ? <Text style={[type.bodyMd, { color: color.muted }]}>No default rate. Customer-specific rates still apply.</Text> : v.rates.map((r) => <Row key={r.id} label={`From ${dateLabel(r.effectiveFrom)}`} value={`${rupees(r.hourlyRate)}/h`} />)}
              <Text style={[type.bodySm, { color: color.muted }]}>Used when a customer has no agreed rate. A new rate applies only to work on or after its date.</Text>
            </Card>
          </View>
          <View style={{ gap: space.md }}>
            <SectionTitle icon="event">Upcoming & current jobs</SectionTitle>
            {v.upcoming.length === 0 ? <Text style={[type.bodyMd, { color: color.muted }]}>No open jobs.</Text> : v.upcoming.map((w) => <ListRow key={w.id} title={`${w.code} · ${dateLabel(w.workDate)}`} subtitle={`${w.customerName} · ${w.siteName} · ${w.driverName}`} right={<StatusBadge status={w.status} />} href={`/work/${w.id}`} />)}
            <SectionTitle icon="build" right={can("MAINTENANCE") ? <Btn compact variant="ghost" label="Add" onPress={() => router.push({ pathname: "/fleet/maintenance/new", params: { vehicleId: v.id } })} /> : undefined}>Maintenance</SectionTitle>
            {v.maintenance.length === 0 ? <Text style={[type.bodyMd, { color: color.muted }]}>No maintenance recorded.</Text> : v.maintenance.map((m) => <ListRow key={m.id} title={m.title} subtitle={`${m.category}${m.scheduledOn ? ` · ${dateLabel(m.scheduledOn)}` : ""}${m.cost ? ` · ${rupees(m.cost)}` : ""}`} right={<StatusBadge status={m.status} />} />)}
          </View>
        </Grid>
      </Screen>

      <ConfirmDialog
        visible={statusOpen}
        title="Change machine status"
        body="Assigned and Working are set automatically from jobs. Moving to Maintenance or Inactive is blocked while the machine has open jobs."
        confirmLabel="Save"
        reasonLabel="Reason"
        minReason={3}
        onCancel={() => setStatusOpen(false)}
        onConfirm={async (reason) => {
          await api.post(`/vehicles/${v.id}/status`, { status: newStatus, reason });
          setStatusOpen(false);
          flash.ok("Status updated");
          await q.refresh();
        }}
      >
        <Select label="Status" value={newStatus} onChange={setNewStatus} options={[{ value: "AVAILABLE", label: "Available" }, { value: "MAINTENANCE", label: "Maintenance" }, { value: "INACTIVE", label: "Inactive (not in service)" }]} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={rateOpen}
        title="Add default hourly rate"
        body="Earlier work and issued invoices keep their original rates."
        confirmLabel="Add rate"
        onCancel={() => setRateOpen(false)}
        onConfirm={async () => {
          if (!isMoney(rate) || !isValidDate(rateFrom)) throw new Error("Enter a valid rate and date.");
          await api.post(`/vehicles/${v.id}/rates`, { hourlyRate: rate, effectiveFrom: rateFrom });
          setRateOpen(false);
          setRate("");
          flash.ok("Rate added");
          await q.refresh();
        }}
      >
        <MoneyInput label="Hourly rate" required value={rate} onChange={setRate} />
        <DateInput label="Effective from" value={rateFrom} onChange={setRateFrom} quick={false} />
      </ConfirmDialog>
    </>
  );
}
