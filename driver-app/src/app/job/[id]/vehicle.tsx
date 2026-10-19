import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { AppHeader, Badge, Banner, Card, ErrorView, Icon, LoadingView, Row, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { meter } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

export default function VehicleDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useLoad(() => api.workOrder(id), [id]);
  const header = <AppHeader back title="Machine & attachments" eyebrow={q.data?.code} />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const wo = q.data;
  const v = wo.vehicle;

  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        <View style={{ backgroundColor: color.navy, borderRadius: radius.xl, padding: space.lg, gap: space.sm }}>
          <Text style={[type.labelSm, { color: color.accent }]}>{v.unitCode} · {v.category}</Text>
          <Text style={[type.displaySm, { color: color.white }]}>{v.make} {v.model}</Text>
          <View style={{ alignSelf: "flex-start", backgroundColor: color.white, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 2, borderColor: color.accent }}>
            <Text style={{ fontFamily: font.extrabold, fontSize: 18, color: color.ink, letterSpacing: 1 }}>{v.registrationNo}</Text>
          </View>
        </View>

        <SectionTitle icon="speed">Meter reference</SectionTitle>
        <Card>
          <Row label="Last approved reading" value={wo.vehicleLastApprovedMeter ? `${meter(wo.vehicleLastApprovedMeter)} h` : "No approved readings yet"} strong />
          <Text style={[type.bodySm, { color: color.muted }]}>Compare with the cab meter before starting. If the meter shows less, tell dispatch.</Text>
        </Card>
        {wo.vehicleNotes && <Banner tone="info" title="Machine notes" body={wo.vehicleNotes} />}

        <SectionTitle icon="handyman" right={<Badge label={`${wo.attachmentsDetail.length} assigned`} tone="neutral" />}>Assigned attachments</SectionTitle>
        {wo.attachmentsDetail.length === 0 ? (
          <Card><Text style={[type.bodyMd, { color: color.muted }]}>No attachments for this job.</Text></Card>
        ) : (
          wo.attachmentsDetail.map((a) => (
            <Card key={a.code}>
              <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
                <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
                  <Icon name="hardware" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.labelLg, { color: color.ink }]}>{a.name}</Text>
                  <Text style={[type.bodySm, { color: color.muted }]}>{a.type} · {a.code}</Text>
                </View>
              </View>
              {a.notes ? <Text style={[type.bodySm, { color: color.navy }]}>{a.notes}</Text> : null}
            </Card>
          ))
        )}
        <Text style={[type.bodySm, { color: color.muted }]}>
          Machine records, rental rates and maintenance are managed by the AJ office and are read-only here.
        </Text>
      </Screen>
    </>
  );
}
