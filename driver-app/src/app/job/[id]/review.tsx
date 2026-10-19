import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { AuthImage } from "@/components/AuthImage";
import { FlagList } from "@/components/FlagList";
import { SubmitStatus } from "@/components/SubmitStatus";
import { AppHeader, Banner, Btn, Card, ErrorView, LoadingView, Row, Screen, SectionTitle, useOffline } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { clearDraft, useDraft } from "@/lib/drafts";
import { hours, meter, rupees, timeLabel } from "@/lib/format";
import { submitDraft } from "@/lib/submit";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

/** Final check before the ending reading is sent: both photos side by side, the calculation, and server-side flags. */
export default function ReviewSubmission() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const offline = useOffline();
  const draft = useDraft(id, "END");
  const q = useLoad(() => Promise.all([api.workOrder(id), api.me()]), [id]);
  const [check, setCheck] = useState<{ hours: string | null; flags: string[] } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    if (!draft.value) return;
    api.checkReading(id, "END", draft.value.trim()).then(setCheck, (e) => setCheckError(e instanceof ApiError ? e.message : "Could not check the reading."));
  }, [id, draft.value]);

  const header = <AppHeader back title="Review & submit" eyebrow="Operational review" />;
  if (!draft.photo || !draft.value) {
    return (
      <>
        {header}
        <Screen>
          <Banner tone="warning" title="Nothing to review" body="Enter the ending reading and take a photo first." action={<Btn compact variant="outline" label="Back to ending reading" onPress={() => router.replace(`/job/${id}/reading?kind=END`)} />} />
        </Screen>
      </>
    );
  }
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const [wo, me] = q.data;
  const start = wo.start!;
  const computed = check?.hours ?? (Number(draft.value) - Number(start.value)).toFixed(1);
  const rate = me.compensation?.method === "HOURLY" ? me.compensation.hourlyRate : null;

  const submit = async () => {
    const res = await submitDraft(id, "END");
    if (res.ok) {
      clearDraft(id, "END");
      router.replace({ pathname: "/job/[id]/submitted", params: { id, kind: "END" } });
    }
  };

  return (
    <>
      {header}
      <Screen
        footer={
          <>
            <Btn
              variant="accent"
              icon={draft.sendState === "uncertain" ? "sync" : "send"}
              label={draft.sendState === "uncertain" ? "Retry submission" : draft.sendState === "failed" ? "Try again" : "Confirm & submit work record"}
              onPress={submit}
              loading={draft.sendState === "sending"}
              disabled={offline}
              sub={offline ? "Internet connection required" : undefined}
            />
            <Btn variant="ghost" icon="edit" label="Edit reading or retake photo" onPress={() => router.back()} disabled={draft.sendState === "sending" || draft.sendState === "uncertain"} />
          </>
        }
      >
        <Card accent={color.accent}>
          <View style={{ paddingLeft: 6, gap: 2 }}>
            <Text style={[type.labelSm, { color: color.muted }]}>{wo.code}</Text>
            <Text style={[type.headlineMd, { color: color.ink }]}>{wo.siteName}</Text>
            <Text style={[type.bodyMd, { color: color.navy }]}>{wo.vehicle.make} {wo.vehicle.model} · {wo.vehicle.registrationNo}</Text>
          </View>
        </Card>

        <SectionTitle icon="compare">Meter photos side by side</SectionTitle>
        <View style={{ flexDirection: "row", gap: space.md }}>
          <Card style={{ flex: 1 }}>
            <Text style={[type.labelSm, { color: color.muted }]}>Start photo</Text>
            <AuthImage path={start.photoUrl} style={{ width: "100%", aspectRatio: 3 / 4, borderRadius: radius.md }} label="Starting meter photo" />
            <Text style={[type.headlineMd, { color: color.ink, fontVariant: ["tabular-nums"] }]}>{meter(start.value)}</Text>
            <Text style={[type.bodySm, { color: color.muted }]}>{timeLabel(start.submittedAt)}</Text>
          </Card>
          <Card style={{ flex: 1, borderColor: color.accent }}>
            <Text style={[type.labelSm, { color: color.warningText }]}>End photo (new)</Text>
            <Image source={{ uri: draft.photo.uri }} style={{ width: "100%", aspectRatio: 3 / 4, borderRadius: radius.md }} contentFit="cover" accessibilityLabel="Ending meter photo" />
            <Text style={[type.headlineMd, { color: color.ink, fontVariant: ["tabular-nums"] }]}>{meter(draft.value)}</Text>
            <Text style={[type.bodySm, { color: color.muted }]}>Taken {timeLabel(draft.photo.capturedAt)}</Text>
          </Card>
        </View>

        <SectionTitle icon="calculate">Calculation</SectionTitle>
        <Card>
          <Row label="Ending reading" value={`${meter(draft.value)} h`} />
          <Row label="Starting reading" value={`− ${meter(start.value)} h`} />
          <View style={{ height: 1, backgroundColor: color.border }} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={[type.headlineSm, { color: color.ink, fontFamily: font.bold }]}>Operating hours</Text>
            <Text style={[type.displaySm, { color: Number(computed) < 0 ? color.dangerText : color.ink }]}>{hours(computed)}</Text>
          </View>
          {rate && Number(computed) > 0 && (
            <Text style={[type.bodySm, { color: color.muted }]}>
              Estimate only: {hours(computed)} × {rupees(rate)}/h = {rupees(Number(computed) * Number(rate))}. Nothing is credited until an admin approves these hours and payroll is run.
            </Text>
          )}
        </Card>

        {checkError && <Banner tone="warning" title="Could not run the server check" body={checkError} />}
        {check && check.flags.length === 0 && <Banner tone="success" title="No problems found" body="The readings passed the automatic checks. An admin still reviews every submission." />}
        {check && <FlagList flags={check.flags} />}
        {draft.note ? <Banner tone="info" icon="sticky-note-2" title="Your note" body={draft.note} /> : null}

        <SubmitStatus draft={draft} />
        <Text style={[type.bodySm, { color: color.muted }]}>
          After you submit, readings can only be changed if an admin rejects them and asks for a correction.
        </Text>
      </Screen>
    </>
  );
}
