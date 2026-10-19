import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { DateInput, isValidDate, ListRow } from "@/components/kit";
import { AppHeader, Banner, EmptyView, ErrorView, LoadingView, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, meter } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

interface Row { workOrderId: string; code: string; workDate: string; driverName: string; customerName: string; startMeter: string; endMeter: string; approvedHours: string; breakerHours: string; adjustmentKind: string | null }

/** Approved meter history for one machine, newest first, with gaps between jobs highlighted (Stitch: admin_vehicle_meter_history). */
export default function VehicleMeterHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useLoad(() => api.get<Row[]>(`/vehicles/${id}/meter-history`, { from: isValidDate(from) ? from : undefined, to: isValidDate(to) ? to : undefined }), [id, from, to]);

  return (
    <>
      <AppHeader back title="Meter history" eyebrow="Approved readings" />
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        <View style={{ flexDirection: "row", gap: space.md }}>
          <View style={{ flex: 1 }}><DateInput label="From" value={from} onChange={setFrom} quick={false} /></View>
          <View style={{ flex: 1 }}><DateInput label="To" value={to} onChange={setTo} quick={false} /></View>
        </View>
        <Banner tone="info" title="How to read this" body="Each row is one approved job. A gap means the next job started above the previous ending reading (machine used without a recorded job). A start below the previous end was flagged at review." />
        {q.loading ? (
          <LoadingView />
        ) : !q.data ? (
          <ErrorView error={q.error!} onRetry={q.reload} />
        ) : q.data.length === 0 ? (
          <EmptyView icon="speed" title="No approved readings" />
        ) : (
          q.data.map((r, i) => {
            const older = q.data![i + 1];
            const gap = older ? Number(r.startMeter) - Number(older.endMeter) : 0;
            return (
              <View key={r.workOrderId} style={{ gap: 4 }}>
                <ListRow
                  title={`${meter(r.startMeter)} → ${meter(r.endMeter)} · +${r.approvedHours} h`}
                  subtitle={`${dateLabel(r.workDate)} · ${r.code} · ${r.driverName} · ${r.customerName}${Number(r.breakerHours) > 0 ? ` · breaker ${r.breakerHours} h` : ""}`}
                  meta={r.adjustmentKind ? `Correction: ${r.adjustmentKind.toLowerCase().replace("_", " ")}` : undefined}
                  href={`/work/${r.workOrderId}`}
                  accent={r.adjustmentKind ? color.warning : color.success}
                />
                {older && Math.abs(gap) >= 0.1 && (
                  <Text style={[type.bodySm, { color: gap < 0 ? color.dangerText : color.warningText, paddingLeft: space.md }]}>
                    {gap > 0 ? `↕ ${gap.toFixed(1)} h unaccounted between jobs` : `↕ starts ${Math.abs(gap).toFixed(1)} h below the previous end`}
                  </Text>
                )}
              </View>
            );
          })
        )}
      </Screen>
    </>
  );
}
