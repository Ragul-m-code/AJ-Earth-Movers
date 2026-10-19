import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { AuthImage } from "@/components/AuthImage";
import { FlagList } from "@/components/FlagList";
import { nextAction } from "@/components/JobCard";
import { AppHeader, Badge, Banner, Btn, Card, Dialog, ErrorView, Field, Icon, LoadingView, Metric, Row, Screen, SectionTitle, useOffline } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { dateLabel, hours, meter, rupees, timeLabel } from "@/lib/format";
import { STATUS_META } from "@/lib/meterRules";
import type { Reading, WorkOrderDetail, WorkOrderStatus } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const offline = useOffline();
  const q = useLoad(() => api.workOrder(id), [id]);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const header = <AppHeader back title={q.data?.code ?? "Job details"} eyebrow="Work order" />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const wo = q.data;
  const meta = STATUS_META[wo.status];
  const action = nextAction(wo);

  const respond = async (accept: boolean) => {
    setBusy(accept ? "accept" : "decline");
    setActionError(null);
    try {
      if (accept) await api.accept(wo.id);
      else await api.decline(wo.id, declineReason.trim());
      setDeclineOpen(false);
      await q.refresh();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Could not update the job.");
      // The status may have changed elsewhere; show the latest.
      if (e instanceof ApiError && e.status === 409) await q.refresh();
    } finally {
      setBusy(null);
    }
  };

  const footer =
    wo.status === "ASSIGNED" ? (
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Btn variant="outline" label="Decline" icon="close" onPress={() => setDeclineOpen(true)} disabled={offline || busy !== null} />
        </View>
        <View style={{ flex: 2 }}>
          <Btn variant="accent" label="Accept job" icon="check-circle" onPress={() => respond(true)} loading={busy === "accept"} disabled={offline || busy !== null} />
        </View>
      </View>
    ) : action ? (
      <Btn variant={action.variant} label={action.label} icon={action.icon} onPress={() => router.push(action.href)} />
    ) : undefined;

  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing} footer={footer}>
        {actionError && <Banner tone="danger" title="Not updated" body={actionError} />}

        <Card accent={color.accent}>
          <View style={{ paddingLeft: 6, gap: space.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
              <View style={{ backgroundColor: color.accentSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm }}>
                <Text style={[type.labelMd, { color: color.warningText, fontFamily: font.bold }]}>{wo.code}</Text>
              </View>
              <Badge label={meta.label} tone={meta.tone} />
            </View>
            <Text style={[type.headlineLg, { color: color.ink }]}>{wo.siteName}</Text>
            <Text style={[type.bodyMd, { color: color.muted }]}>Customer: {wo.customer.name}</Text>
            <Row label="Date" value={`${dateLabel(wo.workDate)}${wo.shiftLabel ? ` · ${wo.shiftLabel}` : ""}`} />
            {wo.plannedHours && <Row label="Planned duration" value={hours(wo.plannedHours)} />}
          </View>
        </Card>

        <StatusPanel wo={wo} />
        <Stepper wo={wo} />

        <SectionTitle icon="construction" right={<Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.push(`/job/${wo.id}/vehicle`)}><Text style={[type.labelLg, { fontFamily: font.bold, color: color.navy }]}>Details ›</Text></Pressable>}>
          Assigned machine
        </SectionTitle>
        <Card>
          <Text style={[type.headlineSm, { color: color.ink, fontFamily: font.bold }]}>{wo.vehicle.make} {wo.vehicle.model}</Text>
          <Row label="Unit" value={wo.vehicle.unitCode} />
          <Row label="Registration" value={wo.vehicle.registrationNo} />
          {wo.attachments.length > 0 ? (
            wo.attachments.map((a) => <Row key={a.code} label={a.type} value={a.name} />)
          ) : (
            <Text style={[type.bodySm, { color: color.muted }]}>No attachments assigned.</Text>
          )}
        </Card>

        <SectionTitle icon="place">Worksite</SectionTitle>
        <Card>
          <Text style={[type.labelLg, { color: color.ink }]}>{wo.siteName}</Text>
          {wo.siteAddress && <Text style={[type.bodyMd, { color: color.muted }]}>{wo.siteAddress}</Text>}
          {wo.siteContactName && <Row label="Site contact" value={wo.siteContactName} />}
          {wo.siteContactPhone && (
            <Btn compact variant="outline" icon="call" label={`Call ${wo.siteContactPhone}`} onPress={() => Linking.openURL(`tel:${wo.siteContactPhone!.replace(/\s/g, "")}`)} />
          )}
          {wo.instructions && (
            <View style={{ backgroundColor: color.warningBg, borderRadius: radius.md, padding: space.md, gap: 4 }}>
              <Text style={[type.labelSm, { color: color.warningText }]}>Instructions</Text>
              <Text style={[type.bodyMd, { color: color.navy }]}>{wo.instructions}</Text>
            </View>
          )}
        </Card>

        {wo.readings.length > 0 && <Readings wo={wo} />}

        {wo.events.length > 0 && (
          <>
            <SectionTitle icon="history">History</SectionTitle>
            <Card>
              {wo.events.map((e, i) => (
                <View key={i} style={{ flexDirection: "row", gap: space.sm, paddingVertical: 4 }}>
                  <Icon name="circle" size={10} tint={color.borderStrong} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.labelMd, { color: color.ink }]}>{STATUS_META[e.toStatus].label}</Text>
                    {e.note ? <Text style={[type.bodySm, { color: color.muted }]}>{e.note}</Text> : null}
                  </View>
                  <Text style={[type.bodySm, { color: color.muted }]}>{timeLabel(e.createdAt)}</Text>
                </View>
              ))}
            </Card>
          </>
        )}
      </Screen>

      <Dialog visible={declineOpen} onClose={() => setDeclineOpen(false)} title="Decline this job?" body="Dispatch will be told, and the job will be reassigned. Give a short reason.">
        <Field label="Reason" required value={declineReason} onChangeText={setDeclineReason} multiline placeholder="e.g. Unwell today / machine too far" maxLength={500} />
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Btn variant="outline" label="Cancel" onPress={() => setDeclineOpen(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn variant="danger" label="Decline job" onPress={() => respond(false)} loading={busy === "decline"} disabled={declineReason.trim().length < 5 || offline} />
          </View>
        </View>
      </Dialog>
    </>
  );
}

function StatusPanel({ wo }: { wo: WorkOrderDetail }) {
  switch (wo.status) {
    case "ASSIGNED":
      return <Banner tone="info" icon="assignment" title="Awaiting your response" body="Accept to start this job, or decline with a reason." />;
    case "ACCEPTED":
      return <Banner tone="info" icon="photo-camera" title="Ready to start" body="At the machine, record the starting hour-meter reading with a photo." />;
    case "IN_PROGRESS":
      return (
        <Banner
          tone="success"
          icon="engineering"
          title="Work in progress"
          body={`Started at ${meter(wo.start!.value)} h (${timeLabel(wo.start!.submittedAt)}). Record the ending reading when work is finished.`}
        />
      );
    case "PENDING_APPROVAL":
      return (
        <Card>
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <Icon name="hourglass-top" tint={color.warning} />
            <Text style={[type.headlineSm, { color: color.warningText, fontFamily: font.bold, flex: 1 }]}>Pending admin verification</Text>
          </View>
          <Text style={[type.bodyMd, { color: color.navy }]}>
            The server received your readings and photos. An admin will check them against the photos. These hours are not yet counted for pay or billing.
          </Text>
          <View style={{ flexDirection: "row", gap: space.md, backgroundColor: color.recessed, padding: space.md, borderRadius: radius.md }}>
            <Metric label="Start" value={meter(wo.start!.value)} />
            <Metric label="End" value={meter(wo.end!.value)} />
            <Metric label="Hours" value={Number(wo.operatingHours).toFixed(1)} tone="warning" />
          </View>
          <FlagList flags={wo.flags} />
          {wo.submittedAt && <Text style={[type.bodySm, { color: color.muted }]}>Submitted {timeLabel(wo.submittedAt)}. Pull down to check for updates.</Text>}
        </Card>
      );
    case "CORRECTION_REQUIRED": {
      const r = wo.latestReview;
      const which = [wo.correctionNeeded.start && "starting", wo.correctionNeeded.end && "ending"].filter(Boolean).join(" and ");
      return (
        <View style={{ gap: space.sm, backgroundColor: color.dangerBg, borderRadius: radius.lg, padding: space.md, borderLeftWidth: 4, borderLeftColor: color.danger }} accessibilityRole="alert">
          <Text style={[type.labelSm, { color: color.dangerText }]}>Action required</Text>
          <Text style={[type.headlineMd, { color: color.dangerText }]}>Reading rejected: correction needed</Text>
          {r?.reason && <Text style={[type.bodyMd, { color: color.navy, fontStyle: "italic" }]}>“{r.reason}”</Text>}
          {r && <Text style={[type.bodySm, { color: color.muted }]}>Reviewed {timeLabel(r.createdAt)}</Text>}
          <Text style={[type.bodyMd, { color: color.navy }]}>
            Resubmit the {which || "requested"} reading with a new photo. Your original submission is kept on record and is not deleted.
          </Text>
        </View>
      );
    }
    case "APPROVED":
      return (
        <Card>
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <Icon name="verified" tint={color.success} />
            <Text style={[type.headlineSm, { color: color.successText, fontFamily: font.bold }]}>Hours approved</Text>
          </View>
          {wo.approved && (
            <>
              <Row label="Approved hours" value={hours(wo.approved.hours)} strong />
              {wo.approved.compensationMethod === "HOURLY" && wo.approved.driverRate ? (
                <>
                  <Row label="Your rate on this date" value={`${rupees(wo.approved.driverRate, { paise: true })} / h`} />
                  <Row label="Earned for this job" value={rupees(wo.approved.driverAmount, { paise: true })} strong />
                </>
              ) : (
                <Row label="Pay" value="Covered by your monthly salary" />
              )}
              <Text style={[type.bodySm, { color: color.muted }]}>
                {wo.approved.inPayroll ? "Included in a payroll run." : "Will be included in your next payroll. Adjustments, if any, are applied there."}
              </Text>
            </>
          )}
        </Card>
      );
    case "DECLINED":
      return <Banner tone="neutral" title="You declined this job" body={wo.declineReason ?? undefined} />;
    case "CANCELLED":
      return <Banner tone="neutral" title="Cancelled by dispatch" body="No action is needed." />;
  }
}

const STEPS: { key: string; label: string; reached: (s: WorkOrderStatus) => boolean }[] = [
  { key: "assigned", label: "Assigned by dispatch", reached: () => true },
  { key: "accepted", label: "Accepted", reached: (s) => !["ASSIGNED", "DECLINED", "CANCELLED"].includes(s) },
  { key: "started", label: "Starting meter recorded", reached: (s) => ["IN_PROGRESS", "PENDING_APPROVAL", "CORRECTION_REQUIRED", "APPROVED"].includes(s) },
  { key: "submitted", label: "Ending meter submitted", reached: (s) => ["PENDING_APPROVAL", "CORRECTION_REQUIRED", "APPROVED"].includes(s) },
  { key: "approved", label: "Approved by admin", reached: (s) => s === "APPROVED" },
];

function Stepper({ wo }: { wo: WorkOrderDetail }) {
  if (wo.status === "DECLINED" || wo.status === "CANCELLED") return null;
  const currentIdx = STEPS.findIndex((s) => !s.reached(wo.status));
  return (
    <Card>
      <Text style={[type.labelSm, { color: color.muted }]}>Job progress</Text>
      {STEPS.map((s, i) => {
        const done = s.reached(wo.status);
        const current = i === currentIdx;
        return (
          <View key={s.key} style={{ flexDirection: "row", gap: space.sm, alignItems: "center", minHeight: 28 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: done ? color.navy : current ? color.accent : color.recessed }}>
              {done ? <Icon name="check" size={14} tint={color.white} /> : <Text style={{ fontFamily: font.bold, fontSize: 11, color: color.navy }}>{i + 1}</Text>}
            </View>
            <Text style={[type.bodyMd, { color: done ? color.ink : current ? color.ink : color.muted, fontFamily: current ? font.bold : font.regular }]}>{s.label}</Text>
          </View>
        );
      })}
    </Card>
  );
}

function Readings({ wo }: { wo: WorkOrderDetail }) {
  const activeIds = new Set([wo.start?.id, wo.end?.id]);
  return (
    <>
      <SectionTitle icon="speed">Meter readings & photos</SectionTitle>
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
          {wo.readings.map((r) => (
            <ReadingTile key={r.id} r={r} superseded={!activeIds.has(r.id)} />
          ))}
        </View>
        {wo.operatingHours && (
          <View style={{ backgroundColor: color.recessed, borderRadius: radius.md, padding: space.md }}>
            <Row label="Operating hours (end − start)" value={`${meter(wo.end!.value)} − ${meter(wo.start!.value)} = ${hours(wo.operatingHours)}`} strong />
          </View>
        )}
      </Card>
    </>
  );
}

function ReadingTile({ r, superseded }: { r: Reading; superseded: boolean }) {
  return (
    <View style={{ width: "47%", flexGrow: 1, gap: 4, opacity: superseded ? 0.6 : 1 }}>
      <AuthImage path={r.photoUrl} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md }} label={`${r.kind === "START" ? "Starting" : "Ending"} meter photo`} />
      <Text style={[type.labelSm, { color: color.muted }]}>
        {r.kind === "START" ? "Start" : "End"}
        {r.revision > 1 ? ` · correction ${r.revision - 1}` : ""}
        {superseded ? " · replaced" : ""}
      </Text>
      <Text style={[type.headlineMd, { color: color.ink, fontVariant: ["tabular-nums"], textDecorationLine: superseded ? "line-through" : "none" }]}>{meter(r.value)} h</Text>
      <Text style={[type.bodySm, { color: color.muted }]}>{timeLabel(r.submittedAt)}</Text>
      {r.note ? <Text style={[type.bodySm, { color: color.navy }]}>Note: {r.note}</Text> : null}
    </View>
  );
}
