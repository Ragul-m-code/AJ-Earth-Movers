import { useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";
import { AppHeader, Banner, Btn, Card, ErrorView, Icon, LoadingView, Row, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { hours, meter, timeLabel } from "@/lib/format";
import { FlagList } from "@/components/FlagList";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

/** Shown only after the server confirmed the reading; the data below is re-read from the server, not from the draft. */
export default function Submitted() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind: "START" | "END" }>();
  const router = useRouter();
  const q = useLoad(() => api.workOrder(id), [id]);
  const isStart = kind === "START";

  const header = <AppHeader title={isStart ? "Work started" : "Work record submitted"} eyebrow={q.data?.code} />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const wo = q.data;
  const reading = isStart ? wo.start : wo.end;

  return (
    <>
      {header}
      <Screen
        footer={
          <>
            <Btn variant="accent" icon="home" label="Back to home" onPress={() => router.replace("/")} />
            <Btn variant="outline" icon="description" label="View job details" onPress={() => router.replace(`/job/${id}`)} />
          </>
        }
      >
        <Card>
          <View style={{ alignItems: "center", gap: space.sm, paddingVertical: space.md }}>
            <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: color.success, alignItems: "center", justifyContent: "center" }}>
              <Icon name="check" size={40} tint={color.white} />
            </View>
            <Text style={[type.headlineLg, { color: color.ink, textAlign: "center" }]}>
              {isStart ? "Starting reading received" : wo.status === "CORRECTION_REQUIRED" ? "Correction received" : "Work record received"}
            </Text>
            <Text style={[type.bodyMd, { color: color.muted, textAlign: "center" }]}>
              The AJ server confirmed it{reading ? ` at ${timeLabel(reading.submittedAt)}` : ""}.
            </Text>
          </View>
        </Card>

        {reading && (
          <Card>
            <Row label={isStart ? "Starting reading" : "Ending reading"} value={`${meter(reading.value)} h`} strong />
            {!isStart && wo.operatingHours && <Row label="Operating hours" value={hours(wo.operatingHours)} strong />}
            <Row label="Machine" value={`${wo.vehicle.make} ${wo.vehicle.model}`} />
            <Row label="Photo" value="Uploaded" />
          </Card>
        )}

        {isStart ? (
          <Banner tone="info" title="Next step" body="When the work is finished, open this job and record the ending meter reading with a photo." />
        ) : wo.status === "PENDING_APPROVAL" ? (
          <Banner tone="warning" icon="hourglass-top" title="Pending admin approval" body="These hours are not yet approved. They count for pay and billing only after an admin verifies the readings and photos." />
        ) : wo.status === "CORRECTION_REQUIRED" ? (
          <Banner tone="danger" title="One more correction is needed" body="Open the job to resubmit the remaining reading." />
        ) : null}
        <FlagList flags={wo.flags} />
      </Screen>
    </>
  );
}
