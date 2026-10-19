import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { ConfirmDialog, DateInput, Grid, InfoGrid, isMoney, isValidDate, Kpi, ListRow, MoneyInput, Segmented, Select, StatusBadge, useFlash } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, ErrorView, Field, LoadingView, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, daysFromToday, hours, rupees, todayIst } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";
import { color, font, space, type } from "@/theme";

interface DriverProfile {
  id: string; driverCode: string; fullName: string; phone: string; emergencyContact: string | null; licenseNumber: string | null; licenseExpiry: string | null; joinedOn: string | null; address: string | null; status: string;
  account: { loginId: string; status: string; locked: boolean };
  compensation: { method: string; hourlyRate: string | null; monthlySalary: string | null; effectiveFrom: string; note: string | null }[] | null;
  openJobs: { id: string; code: string; status: string; workDate: string; vehicle: string; customerName: string; siteName: string }[];
  last30Days: { approvedHours: string; workingDays: number; pendingSubmissions: number };
}

/** Stitch: admin_driver_profile */
export default function DriverProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const flash = useFlash();
  const q = useLoad(() => api.get<DriverProfile>(`/drivers/${id}`), [id]);
  const [statusOpen, setStatusOpen] = useState(false);
  const [status, setStatus] = useState("ACTIVE");
  const [pin, setPin] = useState<string | null>(null);
  const [pinConfirm, setPinConfirm] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjKind, setAdjKind] = useState<"ADDITION" | "DEDUCTION">("ADDITION");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjDesc, setAdjDesc] = useState("");
  const [adjDate, setAdjDate] = useState(todayIst());

  const header = <AppHeader back title={q.data?.fullName ?? "Driver"} eyebrow={q.data?.driverCode} />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const d = q.data;
  const current = d.compensation?.find((c) => c.effectiveFrom <= todayIst());
  const licenceSoon = d.licenseExpiry && d.licenseExpiry <= daysFromToday(30);

  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        {flash.node}
        {pin && (
          <Banner tone="success" title={`Temporary PIN for ${d.driverCode}: ${pin}`} body="Give it to the driver in person. It is shown only once; their old sessions were signed out." action={<Btn compact variant="outline" label="Done" onPress={() => setPin(null)} />} />
        )}
        <Card accent={color.accent}>
          <View style={{ paddingLeft: 6, gap: space.sm }}>
            <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: color.navy, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: font.extrabold, fontSize: 20, color: color.accent }}>{d.fullName.replace(/\(.*?\)/g, "").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("")}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.headlineLg, { color: color.ink }]}>{d.fullName}</Text>
                <Text style={[type.bodySm, { color: color.muted }]}>{d.driverCode} · sign-in ID {d.account.loginId}{d.account.locked ? " · locked after failed attempts" : ""}</Text>
              </View>
              <StatusBadge status={d.status} />
            </View>
            <InfoGrid items={[["Mobile", d.phone], ["Emergency contact", d.emergencyContact], ["Licence", d.licenseNumber], ["Licence expiry", d.licenseExpiry && dateLabel(d.licenseExpiry)], ["Joined", d.joinedOn && dateLabel(d.joinedOn)], ["Address", d.address]]} />
            <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
              {can("DRIVERS") && <Btn compact variant="outline" icon="edit" label="Edit" onPress={() => router.push({ pathname: "/more/drivers/edit", params: { id: d.id } })} />}
              <Btn compact variant="outline" icon="call" label="Call" onPress={() => Linking.openURL(`tel:${d.phone.replace(/\s/g, "")}`)} />
              {can("DRIVERS") && <Btn compact variant="outline" icon="toggle-on" label="Status" onPress={() => { setStatus(d.status); setStatusOpen(true); }} />}
              {can("DRIVERS") && <Btn compact variant="outline" icon="pin" label="Reset PIN" onPress={() => setPinConfirm(true)} />}
            </View>
          </View>
        </Card>
        {licenceSoon && <Banner tone="warning" title="Driving licence renewal due" body={`Expires ${dateLabel(d.licenseExpiry!)}.`} />}
        <Grid max={3}>
          <Kpi label="Approved, last 30 days" value={hours(d.last30Days.approvedHours)} />
          <Kpi label="Working days, 30 days" value={String(d.last30Days.workingDays)} sub="Distinct dates" />
          <Kpi label="Awaiting review" value={String(d.last30Days.pendingSubmissions)} tone={d.last30Days.pendingSubmissions ? "warning" : undefined} />
        </Grid>
        <Grid max={2}>
          <View style={{ gap: space.md }}>
            {d.compensation && (
              <>
                <SectionTitle icon="payments" right={<Btn compact variant="ghost" label="Manage" onPress={() => router.push({ pathname: "/more/drivers/salary", params: { id: d.id } })} />}>Pay terms</SectionTitle>
                <Card>
                  {current ? (
                    <>
                      <Text style={[type.headlineMd, { color: color.ink }]}>{current.method === "HOURLY" ? `${rupees(current.hourlyRate!, { paise: true })} per approved hour` : `${rupees(current.monthlySalary!)} per month (fixed)`}</Text>
                      <Text style={[type.bodySm, { color: color.muted }]}>Since {dateLabel(current.effectiveFrom)}{current.note ? ` · ${current.note}` : ""}</Text>
                    </>
                  ) : (
                    <Banner tone="danger" title="No pay terms" body="Approvals for this driver will fail until pay terms are set." />
                  )}
                  <Btn compact variant="outline" icon="add" label="Add salary adjustment" onPress={() => setAdjOpen(true)} />
                </Card>
              </>
            )}
            <ListRow icon="history" title="Work history" subtitle="All jobs, approved hours and payroll status" href={{ pathname: "/more/drivers/history", params: { id: d.id } }} />
          </View>
          <View style={{ gap: space.md }}>
            <SectionTitle icon="assignment">Open jobs ({d.openJobs.length})</SectionTitle>
            {d.openJobs.length === 0 ? <Text style={[type.bodyMd, { color: color.muted }]}>No open jobs.</Text> : d.openJobs.map((w) => <ListRow key={w.id} title={`${w.code} · ${dateLabel(w.workDate)}`} subtitle={`${w.vehicle} · ${w.customerName} · ${w.siteName}`} right={<StatusBadge status={w.status} />} href={`/work/${w.id}`} />)}
          </View>
        </Grid>
      </Screen>

      <ConfirmDialog visible={statusOpen} title="Change driver status" body="Inactive drivers are signed out and cannot sign in. Drivers with open jobs must be reassigned first." confirmLabel="Save" reasonLabel="Reason" minReason={3} onCancel={() => setStatusOpen(false)} onConfirm={async (reason) => { await api.post(`/drivers/${d.id}/status`, { status, reason }); setStatusOpen(false); flash.ok("Status updated"); await q.refresh(); }}>
        <Select label="Status" value={status} onChange={setStatus} options={[{ value: "ACTIVE", label: "Active" }, { value: "ON_LEAVE", label: "On leave" }, { value: "INACTIVE", label: "Inactive (left the company)" }]} />
      </ConfirmDialog>
      <ConfirmDialog visible={pinConfirm} title="Reset this driver's PIN?" body="A new temporary PIN is generated and shown once. The driver is signed out on all devices." confirmLabel="Reset PIN" onCancel={() => setPinConfirm(false)} onConfirm={async () => { const r = await api.post<{ temporaryPin: string }>(`/drivers/${d.id}/reset-pin`); setPinConfirm(false); setPin(r.temporaryPin); await q.refresh(); }} />
      <ConfirmDialog
        visible={adjOpen}
        title="Salary adjustment"
        body="Needs approval by another authorized user before it is included in payroll."
        confirmLabel="Submit for approval"
        onCancel={() => setAdjOpen(false)}
        onConfirm={async () => {
          if (!isMoney(adjAmount) || adjDesc.trim().length < 5 || !isValidDate(adjDate)) throw new Error("Enter an amount, a description of at least 5 characters, and a date.");
          await api.post(`/drivers/${d.id}/adjustments`, { kind: adjKind, amount: adjAmount, description: adjDesc.trim(), effectiveOn: adjDate });
          setAdjOpen(false);
          setAdjAmount("");
          setAdjDesc("");
          flash.ok("Adjustment submitted", "Approve it from Finance › Payroll.");
        }}
      >
        <Segmented value={adjKind} onChange={setAdjKind} options={[{ value: "ADDITION", label: "Addition" }, { value: "DEDUCTION", label: "Deduction" }]} />
        <MoneyInput label="Amount" required value={adjAmount} onChange={setAdjAmount} />
        <Field label="Description" required value={adjDesc} onChangeText={setAdjDesc} placeholder="e.g. Night shift allowance, 3 nights" />
        <DateInput label="Applies to (date)" value={adjDate} onChange={setAdjDate} quick={false} />
      </ConfirmDialog>
    </>
  );
}
