import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { DateInput, Grid, isValidDate, Kpi, ListRow, StatusBadge } from "@/components/kit";
import { AppHeader, EmptyView, ErrorView, LoadingView, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, hours, rupees, todayIst } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { space } from "@/theme";

interface History {
  summary: { approvedHours: string; workingDays: number; jobs: number };
  items: { id: string; code: string; status: string; workDate: string; vehicle: string; customerName: string; siteName: string; approvedHours: string | null; driverAmount: string | null; inPayroll: boolean }[];
}

/** Stitch: admin_driver_work_history */
export default function DriverHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [from, setFrom] = useState(`${todayIst().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayIst());
  const q = useLoad(() => api.get<History>(`/drivers/${id}/work-history`, { from: isValidDate(from) ? from : undefined, to: isValidDate(to) ? to : undefined }), [id, from, to]);
  return (
    <>
      <AppHeader back title="Work history" eyebrow="Driver" />
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        <View style={{ flexDirection: "row", gap: space.md }}>
          <View style={{ flex: 1 }}><DateInput label="From" value={from} onChange={setFrom} quick={false} /></View>
          <View style={{ flex: 1 }}><DateInput label="To" value={to} onChange={setTo} quick={false} /></View>
        </View>
        {q.loading ? (
          <LoadingView />
        ) : !q.data ? (
          <ErrorView error={q.error!} onRetry={q.reload} />
        ) : (
          <>
            <Grid max={3}>
              <Kpi label="Approved hours" value={hours(q.data.summary.approvedHours)} />
              <Kpi label="Working days" value={String(q.data.summary.workingDays)} sub="Distinct dates with approved work" />
              <Kpi label="Jobs" value={String(q.data.summary.jobs)} />
            </Grid>
            {q.data.items.length === 0 ? (
              <EmptyView icon="history" title="No jobs in this period" />
            ) : (
              q.data.items.map((w) => (
                <ListRow
                  key={w.id}
                  title={`${w.code} · ${dateLabel(w.workDate)}`}
                  subtitle={`${w.vehicle} · ${w.customerName} · ${w.siteName}`}
                  meta={w.approvedHours ? `${w.approvedHours} h approved${w.driverAmount ? ` · ${rupees(w.driverAmount, { paise: true })}` : ""} · ${w.inPayroll ? "in payroll" : "not in payroll yet"}` : undefined}
                  right={<StatusBadge status={w.status} />}
                  href={`/work/${w.id}`}
                />
              ))
            )}
          </>
        )}
      </Screen>
    </>
  );
}
