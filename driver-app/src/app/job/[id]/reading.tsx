import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { AuthImage } from "@/components/AuthImage";
import { FlagList } from "@/components/FlagList";
import { PhotoProof } from "@/components/PhotoProof";
import { SubmitStatus } from "@/components/SubmitStatus";
import { AppHeader, Banner, Btn, Card, Dialog, ErrorView, Field, LoadingView, Row, Screen, SectionTitle, useOffline } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { clearDraft, updateDraft, useDraft } from "@/lib/drafts";
import { hours, meter, timeLabel } from "@/lib/format";
import { validateMeterInput } from "@/lib/meterRules";
import { submitDraft } from "@/lib/submit";
import type { MeterKind } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

const STEPS = ["0.1", "0.5", "1.0"];

export default function ReadingEntry() {
  const { id, kind: kindParam } = useLocalSearchParams<{ id: string; kind: MeterKind }>();
  const kind: MeterKind = kindParam === "END" ? "END" : "START";
  const router = useRouter();
  const offline = useOffline();
  const q = useLoad(() => api.workOrder(id), [id]);
  const draft = useDraft(id, kind);
  const [touched, setTouched] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmFlags, setConfirmFlags] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isStart = kind === "START";
  const header = <AppHeader back title={isStart ? "Start work" : "End work"} eyebrow={q.data ? q.data.code : "Meter reading"} />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const wo = q.data;

  const isCorrection = wo.status === "CORRECTION_REQUIRED";
  const allowed = isCorrection ? (isStart ? wo.correctionNeeded.start : wo.correctionNeeded.end) : isStart ? wo.status === "ACCEPTED" : wo.status === "IN_PROGRESS";
  const previous = isStart ? wo.start : wo.end;
  const locked = draft.sendState === "sending" || draft.sendState === "uncertain";
  const valueError = validateMeterInput(draft.value);
  const showError = touched && valueError;
  const startValue = isStart ? null : Number(wo.start?.value);
  const preview = !isStart && !valueError && startValue !== null ? Number(draft.value) - startValue : null;

  const setValue = (text: string) => updateDraft(id, kind, { value: text.replace(",", ".").replace(/[^\d.]/g, "") });
  const bump = (step: string) => {
    const base = Number(draft.value || (isStart ? wo.vehicleLastApprovedMeter : wo.start?.value) || 0);
    setValue((Math.round((base + Number(step)) * 10) / 10).toFixed(1));
  };

  const doSubmit = async () => {
    setConfirmFlags(null);
    const res = await submitDraft(id, kind);
    if (res.ok) {
      clearDraft(id, kind);
      router.replace({ pathname: "/job/[id]/submitted", params: { id, kind } });
    } else if (res.kind === "server" && (res.code === "READING_NOT_ALLOWED" || res.code === "STATUS_CHANGED")) {
      await q.refresh();
    }
  };

  const onPrimary = async () => {
    setTouched(true);
    setError(null);
    if (valueError || !draft.photo) {
      if (!draft.photo && !valueError) setError("Take a photo of the meter before continuing.");
      return;
    }
    if (!isStart) {
      router.push({ pathname: "/job/[id]/review", params: { id, kind } });
      return;
    }
    if (draft.sendState === "uncertain") return doSubmit(); // retry exactly what was sent
    setChecking(true);
    try {
      const check = await api.checkReading(id, kind, draft.value.trim());
      if (check.flags.length > 0) setConfirmFlags(check.flags);
      else await doSubmit();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not check the reading.");
    } finally {
      setChecking(false);
    }
  };

  const primaryLabel = isStart
    ? draft.sendState === "uncertain" ? "Retry submission" : isCorrection ? "Submit corrected starting reading" : "Submit reading & start work"
    : "Review hours & submit";

  return (
    <>
      {header}
      <Screen
        footer={
          allowed ? (
            <Btn
              variant="accent"
              icon={draft.sendState === "uncertain" ? "sync" : isStart ? "play-circle-outline" : "fact-check"}
              label={primaryLabel}
              onPress={onPrimary}
              loading={draft.sendState === "sending" || checking}
              disabled={offline}
              sub={offline ? "Internet connection required" : undefined}
            />
          ) : undefined
        }
      >
        {!allowed && (
          <Banner
            tone="info"
            title="This reading is not expected now"
            body={`Job status: ${wo.status.replace(/_/g, " ").toLowerCase()}. Go back to the job for the next step.`}
            action={<Btn compact variant="outline" label="Open job" onPress={() => router.replace(`/job/${id}`)} />}
          />
        )}

        <Card accent={color.accent}>
          <View style={{ paddingLeft: 6, gap: 2 }}>
            <Text style={[type.labelSm, { color: color.muted }]}>{wo.code} · {wo.customer.name}</Text>
            <Text style={[type.headlineMd, { color: color.ink }]}>{wo.siteName}</Text>
            <Text style={[type.bodyMd, { color: color.navy }]}>{wo.vehicle.make} {wo.vehicle.model} · {wo.vehicle.registrationNo}</Text>
          </View>
        </Card>

        {isCorrection && previous && (
          <Banner
            tone="danger"
            title={`Correcting the ${isStart ? "starting" : "ending"} reading`}
            body={`Rejected value: ${meter(previous.value)} h.${wo.latestReview?.reason ? ` Admin remark: “${wo.latestReview.reason}”` : ""} The original stays on record.`}
          />
        )}

        {isStart && wo.vehicleLastApprovedMeter && (
          <Banner tone="info" title={`Last approved reading for this machine: ${meter(wo.vehicleLastApprovedMeter)} h`} body="Your starting reading should normally be at or above this." />
        )}

        {!isStart && wo.start && (
          <Card>
            <Text style={[type.labelSm, { color: color.muted }]}>Starting reading (submitted)</Text>
            <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
              <AuthImage path={wo.start.photoUrl} style={{ width: 88, height: 66, borderRadius: radius.md }} label="Starting meter photo" />
              <View style={{ flex: 1 }}>
                <Text style={[type.headlineLg, { color: color.ink, fontVariant: ["tabular-nums"] }]}>{meter(wo.start.value)} h</Text>
                <Text style={[type.bodySm, { color: color.muted }]}>{timeLabel(wo.start.submittedAt)}</Text>
              </View>
            </View>
          </Card>
        )}

        <SectionTitle icon="speed">{isStart ? "Starting hour-meter reading" : "Ending hour-meter reading"}</SectionTitle>
        <View style={{ backgroundColor: color.navy, borderRadius: radius.xl, padding: space.md, gap: space.md }}>
          <Text style={[type.labelSm, { color: "#CBD5E1" }]}>Running hours on the cab meter</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <TextInput
              value={draft.value}
              onChangeText={setValue}
              onBlur={() => setTouched(true)}
              editable={!locked && allowed}
              keyboardType="decimal-pad"
              placeholder="0000.0"
              placeholderTextColor="#4A6582"
              accessibilityLabel={`${isStart ? "Starting" : "Ending"} meter reading in hours`}
              accessibilityHint="Enter exactly what the hour meter shows, with one decimal"
              maxLength={9}
              style={{ flex: 1, minWidth: 0, minHeight: 64, color: color.accent, fontFamily: font.extrabold, fontSize: 40, letterSpacing: -1, fontVariant: ["tabular-nums"], backgroundColor: color.navyDeep, borderRadius: radius.lg, paddingHorizontal: space.md }}
            />
            <Text style={[type.headlineMd, { color: color.white }]}>HRS</Text>
          </View>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            {STEPS.map((s) => (
              <Pressable
                key={s}
                accessibilityRole="button"
                accessibilityLabel={`Add ${s} hours`}
                disabled={locked || !allowed}
                onPress={() => bump(s)}
                style={{ flex: 1, height: 44, borderRadius: radius.md, backgroundColor: color.navyRaised, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={[type.labelLg, { color: color.white }]}>+{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {showError ? <Text style={[type.bodySm, { color: color.dangerText }]} accessibilityLiveRegion="polite">{valueError}</Text> : null}

        {preview !== null && (
          <Card>
            <Row label="Ending − starting" value={`${meter(draft.value)} − ${meter(startValue!)}`} />
            <Row label="Operating hours (preview)" value={hours(preview)} strong />
            {preview < 0 && <FlagList flags={["END_BELOW_START"]} />}
            <Text style={[type.bodySm, { color: color.muted }]}>Hours count for pay only after admin approval.</Text>
          </Card>
        )}

        <PhotoProof
          title={isStart ? "Starting meter photo" : "Ending meter photo"}
          photo={draft.photo}
          disabled={locked || !allowed}
          onTake={() => router.push({ pathname: "/job/[id]/camera", params: { id, kind } })}
          onRemove={() => updateDraft(id, kind, { photo: null })}
        />

        <Field
          label="Note for admin (optional)"
          value={draft.note}
          onChangeText={(t) => updateDraft(id, kind, { note: t })}
          editable={!locked && allowed}
          multiline
          maxLength={500}
          placeholder="e.g. meter glass is cracked, reading confirmed with supervisor"
        />

        {error && <Banner tone="danger" title="Check before continuing" body={error} />}
        <SubmitStatus draft={draft} />
        <Text style={[type.bodySm, { color: color.muted }]}>
          Readings are saved only on the AJ server, never offline on this phone. Keep the app open until you see the confirmation.
        </Text>
      </Screen>

      <Dialog visible={confirmFlags !== null} onClose={() => setConfirmFlags(null)} title="Please double-check this reading">
        <FlagList flags={confirmFlags ?? []} />
        <Text style={[type.bodyMd, { color: color.navy }]}>If the meter really shows {meter(draft.value || 0)} h, you can submit it. It will be marked for admin review.</Text>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Btn variant="outline" label="Fix reading" onPress={() => setConfirmFlags(null)} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn variant="dark" label="Submit anyway" onPress={doSubmit} />
          </View>
        </View>
      </Dialog>
    </>
  );
}
