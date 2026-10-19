import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { AuthImage } from "@/components/AuthImage";
import { ConfirmDialog, Grid, InfoGrid, Segmented, Select, StatusBadge } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, ErrorView, Field, Icon, LoadingView, Row, Screen, SectionTitle } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { dateLabel, hours, meter, timeLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { FLAG_TEXT, type Reading, type WorkOrderDetail } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

const HOURS = /^\d{1,7}(\.\d)?$/;

export default function MeterReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const q = useLoad(() => api.get<WorkOrderDetail>(`/work-orders/${id}`), [id]);
  const [zoom, setZoom] = useState<Reading | null>(null);
  const [mode, setMode] = useState<"approve" | "reject" | "correct">("approve");
  const [breakerHours, setBreakerHours] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<"START" | "END" | "BOTH">("END");
  const [reason, setReason] = useState("");
  const [adjKind, setAdjKind] = useState<"ROLLOVER" | "METER_REPLACED" | "ADMIN_CORRECTION">("ROLLOVER");
  const [adjHours, setAdjHours] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const header = <AppHeader back title="Meter review" eyebrow={q.data ? `${q.data.code} · ${q.data.vehicle.unitCode}` : "Work order"} />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const w = q.data;
  const hrs = Number(w.operatingHours ?? 0);
  const breaker = w.attachmentsDetail.find((a) => a.chargeable);
  const bh = breakerHours ?? (breaker ? (w.operatingHours && hrs > 0 ? w.operatingHours : "0") : "0");
  const pending = w.status === "PENDING_APPROVAL";

  const valid =
    mode === "approve"
      ? hrs >= 0 && HOURS.test(bh) && Number(bh) <= hrs
      : mode === "reject"
        ? reason.trim().length >= 5
        : HOURS.test(adjHours) && reason.trim().length >= 10;

  const submit = async () => {
    setError(null);
    const body =
      mode === "approve"
        ? { decision: "APPROVED", note: note.trim() || undefined, breakerHours: breaker ? bh : undefined }
        : mode === "reject"
          ? { decision: "REJECTED", correctionTarget: target, reason: reason.trim() }
          : { decision: "APPROVED", note: note.trim() || undefined, breakerHours: breaker ? (Number(bh) <= Number(adjHours) ? bh : adjHours) : undefined, adjustment: { kind: adjKind, approvedHours: adjHours, reason: reason.trim() } };
    try {
      await api.post(`/work-orders/${w.id}/review`, body);
      setConfirm(false);
      router.replace({ pathname: "/work", params: { view: "approvals" } });
    } catch (e) {
      setConfirm(false);
      setError(e instanceof ApiError ? e.message : "The decision was not saved.");
      if (e instanceof ApiError && e.status === 409) await q.refresh();
    }
  };

  return (
    <>
      {header}
      <Screen
        footer={
          pending && can("METER_APPROVAL") ? (
            <Btn
              variant={mode === "reject" ? "danger" : "accent"}
              icon={mode === "reject" ? "undo" : "verified"}
              label={mode === "approve" ? `Approve ${hours(w.operatingHours ?? "0")}` : mode === "reject" ? "Reject & request correction" : `Approve ${adjHours || "…"} h with correction`}
              disabled={!valid}
              onPress={() => setConfirm(true)}
            />
          ) : undefined
        }
      >
        {error && <Banner tone="danger" title="Not saved" body={error} />}
        {!pending && <Banner tone="info" title={`This submission is ${w.status.replace(/_/g, " ").toLowerCase()}`} body="Only submissions pending approval can be reviewed." action={<Btn compact variant="outline" label="Open job" onPress={() => router.replace(`/work/${w.id}`)} />} />}

        <View style={{ backgroundColor: color.navy, borderRadius: radius.xl, padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
            <Text style={[type.labelSm, { color: "#9FB3C8", flexShrink: 1 }]}>Operating hours (end − start)</Text>
            <StatusBadge status={w.status} />
          </View>
          <Text style={{ fontFamily: font.extrabold, fontSize: 44, color: hrs < 0 ? "#FCA5A5" : color.accent, fontVariant: ["tabular-nums"] }}>
            {hrs >= 0 ? "+" : ""}
            {w.operatingHours ?? "—"} h
          </Text>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <MeterBox label={`Start · ${w.start ? timeLabel(w.start.submittedAt) : ""}`} value={w.start ? meter(w.start.value) : "—"} />
            <MeterBox label={`End · ${w.end ? timeLabel(w.end.submittedAt) : ""}`} value={w.end ? meter(w.end.value) : "—"} />
          </View>
        </View>

        {w.flags.length === 0 ? (
          <Banner tone="success" title="Automatic checks passed" body="No anomaly flags. Still compare the readings with the photos before approving." />
        ) : (
          <Banner tone="danger" title={`${w.flags.length} flag(s) need your attention`} body={w.flags.map((f) => FLAG_TEXT[f] ?? f).join(" · ")} />
        )}

        <SectionTitle icon="photo-library">Photo evidence</SectionTitle>
        <View style={{ flexDirection: "row", gap: space.md }}>
          {[w.start, w.end].map((r, i) =>
            r ? (
              <Pressable key={r.id} onPress={() => setZoom(r)} accessibilityRole="imagebutton" accessibilityLabel={`Zoom ${r.kind} meter photo`} style={{ flex: 1, gap: 4 }}>
                <AuthImage path={r.photoUrl} style={{ width: "100%", aspectRatio: 3 / 4, borderRadius: radius.md }} label={`${r.kind} meter photo`} />
                <Text style={[type.labelSm, { color: color.muted }]}>{i === 0 ? "Start" : "End"} dial{r.revision > 1 ? ` · correction ${r.revision - 1}` : ""} · tap to zoom</Text>
                <Text style={[type.headlineMd, { color: color.ink }]}>{meter(r.value)} h</Text>
                {r.note ? <Text style={[type.bodySm, { color: color.navy }]}>Driver note: {r.note}</Text> : null}
              </Pressable>
            ) : null,
          )}
        </View>

        <Grid max={2}>
          <View style={{ gap: space.md }}>
            <SectionTitle icon="construction">Job</SectionTitle>
            <Card>
              <InfoGrid
                items={[
                  ["Machine", `${w.vehicle.make} ${w.vehicle.model} (${w.vehicle.unitCode})`],
                  ["Registration", w.vehicle.registrationNo],
                  ["Operator", `${w.driver.fullName} (${w.driver.driverCode})`],
                  ["Customer · site", `${w.customer.name} · ${w.siteName}`],
                  ["Work date", dateLabel(w.workDate)],
                  ["Attachments", w.attachmentsDetail.map((a) => `${a.name}${a.chargeable ? " (billable)" : ""}`).join(", ") || "None"],
                ]}
              />
            </Card>
          </View>
          <View style={{ gap: space.md }}>
            <SectionTitle icon="history">Machine meter history</SectionTitle>
            <Card>
              {w.vehicleHistory.length === 0 ? (
                <Text style={[type.bodyMd, { color: color.muted }]}>No earlier approved readings for this machine.</Text>
              ) : (
                w.vehicleHistory.map((h) => <Row key={`${h.workDate}${h.startMeter}`} label={`${dateLabel(h.workDate)}: ${meter(h.startMeter)} → ${meter(h.endMeter)}`} value={`+${h.approvedHours} h`} />)
              )}
              {w.vehicleLastApprovedMeter && <Text style={[type.bodySm, { color: color.muted }]}>Last approved reading: {meter(w.vehicleLastApprovedMeter)} h</Text>}
            </Card>
          </View>
        </Grid>

        {pending && can("METER_APPROVAL") && (
          <>
            <SectionTitle icon="gavel">Decision</SectionTitle>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "approve", label: "Approve" },
                { value: "reject", label: "Reject" },
                ...(can("METER_CORRECTION") ? [{ value: "correct" as const, label: "Correction" }] : []),
              ]}
            />
            <Card>
              {mode === "approve" && (
                <>
                  {hrs < 0 && <Banner tone="danger" title="Cannot approve negative hours" body="Reject it so the driver can correct it, or use Correction for a meter rollover or a replaced meter." />}
                  {breaker && (
                    <Field
                      label={`Breaker hours to bill (${breaker.name})`}
                      value={bh}
                      onChangeText={setBreakerHours}
                      keyboardType="decimal-pad"
                      hint="Defaults to all approved hours. Lower it if the breaker was used for part of the shift; 0 means no breaker charge."
                      error={!HOURS.test(bh) || Number(bh) > hrs ? "Between 0 and the approved hours." : null}
                    />
                  )}
                  <Field label="Note (optional)" value={note} onChangeText={setNote} multiline placeholder="e.g. Matches site supervisor's log" />
                  <Text style={[type.bodySm, { color: color.muted }]}>Approving makes these hours billable and payroll-eligible. It cannot be undone from the app.</Text>
                </>
              )}
              {mode === "reject" && (
                <>
                  <Select label="What must the driver correct?" value={target} onChange={(v) => setTarget(v as typeof target)} options={[{ value: "END", label: "Ending reading" }, { value: "START", label: "Starting reading" }, { value: "BOTH", label: "Both readings" }]} />
                  <Field label="Reason shown to the driver" required value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="e.g. The last digit is hidden by glare. Retake the photo straight on." error={reason && reason.trim().length < 5 ? "At least 5 characters." : null} />
                </>
              )}
              {mode === "correct" && (
                <>
                  <Banner tone="warning" title="Authorized correction" body="Use only when end − start is wrong for a real reason (meter rolled over, meter replaced). Both original readings and photos are kept, and the correction is audited." />
                  <Select label="Reason type" value={adjKind} onChange={(v) => setAdjKind(v as typeof adjKind)} options={[{ value: "ROLLOVER", label: "Meter rollover" }, { value: "METER_REPLACED", label: "Meter replaced" }, { value: "ADMIN_CORRECTION", label: "Other authorized correction" }]} />
                  <Field label="Hours to approve" required value={adjHours} onChangeText={setAdjHours} keyboardType="decimal-pad" error={adjHours && !HOURS.test(adjHours) ? "Hours with at most one decimal." : null} />
                  <Field label="Explanation" required value={reason} onChangeText={setReason} multiline placeholder="e.g. Meter rolled from 9999.9 to 0000.0; site log confirms 8 h" error={reason && reason.trim().length < 10 ? "At least 10 characters." : null} />
                </>
              )}
            </Card>
          </>
        )}
      </Screen>

      <ConfirmDialog
        visible={confirm}
        title={mode === "reject" ? "Reject this submission?" : "Approve these hours?"}
        body={
          mode === "approve"
            ? `${hours(w.operatingHours ?? "0")} for ${w.driver.fullName} on ${w.vehicle.unitCode}${breaker ? `, with ${bh} breaker hour(s)` : ""}. They become billable and payable.`
            : mode === "reject"
              ? `The driver will be asked to correct the ${target === "BOTH" ? "starting and ending readings" : target === "END" ? "ending reading" : "starting reading"}.`
              : `${adjHours} h will be approved instead of ${w.operatingHours} h (${adjKind.toLowerCase().replace("_", " ")}).`
        }
        confirmLabel={mode === "reject" ? "Reject" : "Approve"}
        danger={mode === "reject"}
        onCancel={() => setConfirm(false)}
        onConfirm={submit}
      />
      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", padding: space.lg, justifyContent: "center", gap: space.md }}>
          {zoom && <AuthImage path={zoom.photoUrl} style={{ width: "100%", height: "75%", borderRadius: radius.md }} label="Zoomed meter photo" />}
          {zoom && <Text style={[type.headlineMd, { color: color.white, textAlign: "center" }]}>{zoom.kind === "START" ? "Start" : "End"}: {meter(zoom.value)} h · {timeLabel(zoom.submittedAt)}</Text>}
          <Pressable onPress={() => setZoom(null)} accessibilityRole="button" style={{ alignSelf: "center", flexDirection: "row", gap: 6, padding: space.md }}>
            <Icon name="close" tint={color.white} />
            <Text style={[type.labelLg, { color: color.white }]}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

function MeterBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: color.navyDeep, borderRadius: radius.md, padding: space.md }}>
      <Text style={[type.labelSm, { color: "#9FB3C8" }]} numberOfLines={1}>{label}</Text>
      <Text style={{ fontFamily: font.extrabold, fontSize: 22, color: color.white, fontVariant: ["tabular-nums"] }}>{value} h</Text>
    </View>
  );
}
