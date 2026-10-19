import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { AuthImage } from "@/components/AuthImage";
import { ConfirmDialog, DateInput, Grid, InfoGrid, isValidDate, Select, StatusBadge, useFlash } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, ErrorView, Icon, LoadingView, Row, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, hours, meter, rupees, timeLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { FLAG_TEXT, type Lookups, type WorkOrderDetail } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, radius, space, type } from "@/theme";

export default function WorkOrderDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const q = useLoad(() => api.get<WorkOrderDetail>(`/work-orders/${id}`), [id]);
  const flash = useFlash();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);

  const header = <AppHeader back title={q.data?.code ?? "Work order"} eyebrow="Work order details" />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const w = q.data;
  const canChange = can("WORK_ORDERS") && (w.status === "ASSIGNED" || w.status === "DECLINED");
  const canCancel = can("WORK_ORDERS") && ["ASSIGNED", "ACCEPTED", "DECLINED"].includes(w.status);
  const activeIds = new Set([w.start?.id, w.end?.id]);

  return (
    <>
      {header}
      <Screen
        onRefresh={q.refresh}
        refreshing={q.refreshing}
        footer={
          w.status === "PENDING_APPROVAL" && can("METER_APPROVAL") ? (
            <Btn variant="accent" icon="fact-check" label="Review meter submission" onPress={() => router.push(`/work/review/${w.id}`)} />
          ) : canChange || canCancel ? (
            <View style={{ flexDirection: "row", gap: space.sm }}>
              {canCancel && <View style={{ flex: 1 }}><Btn variant="outline" icon="block" label="Cancel job" onPress={() => setCancelOpen(true)} /></View>}
              {canChange && <View style={{ flex: 1 }}><Btn variant="dark" icon="swap-horiz" label={w.status === "DECLINED" ? "Reassign" : "Change assignment"} onPress={() => setReassignOpen(true)} /></View>}
            </View>
          ) : undefined
        }
      >
        {flash.node}
        <Card accent={color.accent}>
          <View style={{ paddingLeft: 6, gap: space.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
              <Text style={[type.headlineLg, { color: color.ink, flex: 1 }]}>{w.customer.name}</Text>
              <StatusBadge status={w.status} />
            </View>
            <InfoGrid
              items={[
                ["Work date", `${dateLabel(w.workDate)}${w.shiftLabel ? ` · ${w.shiftLabel}` : ""}`],
                ["Site", w.siteName],
                ["Machine", `${w.vehicle.make} ${w.vehicle.model} (${w.vehicle.unitCode} · ${w.vehicle.registrationNo})`],
                ["Operator", `${w.driver.fullName} (${w.driver.driverCode})`],
                ["Planned", w.plannedHours ? hours(w.plannedHours) : null],
                ["Created by", w.createdBy],
              ]}
            />
            {w.driver.phone && <Btn compact variant="outline" icon="call" label={`Call operator ${w.driver.phone}`} onPress={() => Linking.openURL(`tel:${w.driver.phone!.replace(/\s/g, "")}`)} />}
          </View>
        </Card>

        {w.status === "DECLINED" && <Banner tone="danger" title="Declined by the operator" body={w.declineReason ?? undefined} />}
        {w.status === "CANCELLED" && <Banner tone="neutral" title="Cancelled" body={w.cancelReason ?? undefined} />}
        {w.status === "CORRECTION_REQUIRED" && <Banner tone="warning" title="Waiting for the driver's correction" body={w.latestReview?.reason ?? undefined} />}
        {w.flags.length > 0 && <Banner tone="warning" title="Flags" body={w.flags.map((f) => FLAG_TEXT[f] ?? f).join(" · ")} />}

        <Grid max={2}>
          <View style={{ gap: space.md }}>
            <SectionTitle icon="speed">Meter readings</SectionTitle>
            <Card>
              {w.readings.length === 0 ? (
                <Text style={[type.bodyMd, { color: color.muted }]}>No readings yet.</Text>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
                  {w.readings.map((r) => (
                    <View key={r.id} style={{ width: "46%", flexGrow: 1, gap: 4, opacity: activeIds.has(r.id) ? 1 : 0.55 }}>
                      <AuthImage path={r.photoUrl} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md }} label={`${r.kind} meter photo`} />
                      <Text style={[type.labelSm, { color: color.muted }]}>{r.kind === "START" ? "Start" : "End"}{r.revision > 1 ? ` · correction ${r.revision - 1}` : ""}{activeIds.has(r.id) ? "" : " · replaced"}</Text>
                      <Text style={[type.headlineMd, { color: color.ink }]}>{meter(r.value)} h</Text>
                      <Text style={[type.bodySm, { color: color.muted }]}>{timeLabel(r.submittedAt)}</Text>
                      {r.note ? <Text style={[type.bodySm, { color: color.navy }]}>Note: {r.note}</Text> : null}
                    </View>
                  ))}
                </View>
              )}
              {w.operatingHours && <Row label="End − start" value={`${meter(w.end!.value)} − ${meter(w.start!.value)} = ${hours(w.operatingHours)}`} strong />}
            </Card>
            {w.ledger && (
              <>
                <SectionTitle icon="account-balance">Billing & payroll</SectionTitle>
                <Card>
                  <Row label="Approved hours" value={hours(w.ledger.approvedHours)} strong />
                  <Row label="Breaker hours billed" value={hours(w.ledger.breakerHours)} />
                  {can("PAYROLL") && (
                    <Row label="Driver pay" value={w.ledger.compensationMethod === "HOURLY" ? `${rupees(w.ledger.driverAmount, { paise: true })} (₹${w.ledger.driverRate}/h)` : "Fixed monthly salary"} />
                  )}
                  <Row label="Invoice" value={w.ledger.invoice ? `${w.ledger.invoice.number ?? "Draft"} · ${w.ledger.invoice.status.toLowerCase().replace("_", " ")}` : "Not invoiced yet"} />
                  <Row label="Payroll" value={w.ledger.payrollRunId ? "Included in a payroll run" : "Not in payroll yet"} />
                  {w.ledger.invoice && can("INVOICES") && <Btn compact variant="outline" label="Open invoice" onPress={() => router.push(`/finance/invoice/${w.ledger!.invoice!.id}`)} />}
                </Card>
              </>
            )}
          </View>
          <View style={{ gap: space.md }}>
            {w.instructions && (
              <>
                <SectionTitle icon="description">Instructions</SectionTitle>
                <Card><Text style={[type.bodyMd, { color: color.ink }]}>{w.instructions}</Text></Card>
              </>
            )}
            {w.reviews.length > 0 && (
              <>
                <SectionTitle icon="gavel">Review decisions</SectionTitle>
                {w.reviews.map((r, i) => (
                  <Card key={i}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <StatusBadge status={r.decision === "APPROVED" ? "APPROVED" : "CORRECTION_REQUIRED"} />
                      <Text style={[type.bodySm, { color: color.muted }]}>{timeLabel(r.createdAt)}</Text>
                    </View>
                    <Text style={[type.bodySm, { color: color.ink }]}>By {r.reviewer} · computed {r.computedHours} h{r.approvedHours ? ` · approved ${r.approvedHours} h` : ""}</Text>
                    {r.adjustmentKind && <Text style={[type.bodySm, { color: color.warningText }]}>Correction ({r.adjustmentKind.toLowerCase().replace("_", " ")}): {r.adjustmentReason}</Text>}
                    {r.reason && <Text style={[type.bodySm, { color: color.navy }]}>“{r.reason}”</Text>}
                  </Card>
                ))}
              </>
            )}
            <SectionTitle icon="history">Status history</SectionTitle>
            <Card>
              {w.events.map((e, i) => (
                <View key={i} style={{ flexDirection: "row", gap: space.sm, paddingVertical: 4 }}>
                  <Icon name="circle" size={10} tint={color.borderStrong} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.labelMd, { color: color.ink }]}>{e.toStatus.replace(/_/g, " ").toLowerCase()}</Text>
                    {e.note ? <Text style={[type.bodySm, { color: color.muted }]}>{e.note}</Text> : null}
                  </View>
                  <Text style={[type.bodySm, { color: color.muted }]}>{timeLabel(e.createdAt)}</Text>
                </View>
              ))}
            </Card>
          </View>
        </Grid>
      </Screen>

      <ConfirmDialog
        visible={cancelOpen}
        title={`Cancel ${w.code}?`}
        body="The operator is notified. Jobs that have started cannot be cancelled; their readings must be reviewed."
        confirmLabel="Cancel job"
        danger
        reasonLabel="Reason"
        onCancel={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          await api.post(`/work-orders/${w.id}/cancel`, { reason });
          setCancelOpen(false);
          flash.ok("Job cancelled");
          await q.refresh();
        }}
      />
      {reassignOpen && <ReassignDialog w={w} onClose={() => setReassignOpen(false)} onDone={async () => { setReassignOpen(false); flash.ok("Assignment updated", "The operator has been notified."); await q.refresh(); }} />}
    </>
  );
}

function ReassignDialog({ w, onClose, onDone }: { w: WorkOrderDetail; onClose: () => void; onDone: () => void }) {
  const lk = useLoad(() => api.get<Lookups>("/lookups"));
  const [driverId, setDriverId] = useState(w.driver.id);
  const [vehicleId, setVehicleId] = useState(w.vehicleId);
  const [workDate, setWorkDate] = useState(w.workDate);
  return (
    <ConfirmDialog
      visible
      title="Change assignment"
      confirmLabel="Save & notify"
      reasonLabel="Reason for the change"
      minReason={3}
      onCancel={onClose}
      onConfirm={async (reason) => {
        if (!isValidDate(workDate)) throw new Error("Enter a valid date.");
        await api.post(`/work-orders/${w.id}/reassign`, { driverId, vehicleId, workDate, reason });
        onDone();
      }}
    >
      {lk.data ? (
        <>
          <Select label="Operator" value={driverId} onChange={setDriverId} searchable options={lk.data.drivers.map((d) => ({ value: d.id, label: d.fullName, hint: d.driverCode }))} />
          <Select label="Machine" value={vehicleId} onChange={setVehicleId} searchable options={lk.data.vehicles.map((v) => ({ value: v.id, label: `${v.unitCode} · ${v.make} ${v.model}`, disabled: v.status !== "AVAILABLE" && v.id !== w.vehicleId }))} />
          <DateInput label="Work date" value={workDate} onChange={setWorkDate} quick={false} />
        </>
      ) : (
        <LoadingView />
      )}
    </ConfirmDialog>
  );
}
