import { useState } from "react";
import { Text, View } from "react-native";
import { DateInput, Grid, Kpi, isValidDate } from "@/components/kit";
import { WorkOrderCard } from "@/components/WorkOrderCard";
import { AppHeader, EmptyView, ErrorView, LoadingView, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, todayIst } from "@/lib/format";
import type { Paged, WorkOrderItem } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, type } from "@/theme";

const GROUPS: [string, string[]][] = [
  ["Working now", ["IN_PROGRESS"]],
  ["Waiting to start", ["ASSIGNED", "ACCEPTED"]],
  ["Submitted for approval", ["PENDING_APPROVAL", "CORRECTION_REQUIRED"]],
  ["Approved", ["APPROVED"]],
  ["Declined / cancelled", ["DECLINED", "CANCELLED"]],
];

/** One day's operations across the fleet (Stitch: admin_daily_operations). */
export default function DailyOperations() {
  const [date, setDate] = useState(todayIst());
  const ok = isValidDate(date);
  const q = useLoad(() => (ok ? api.get<Paged<WorkOrderItem>>("/work-orders", { from: date, to: date, pageSize: 100 }) : Promise.resolve(null)), [date]);
  const items = q.data?.items ?? [];
  const approvedHours = items.filter((w) => w.status === "APPROVED").reduce((s, w) => s + Number(w.approved?.hours ?? 0), 0);
  const submittedHours = items.filter((w) => w.status === "PENDING_APPROVAL").reduce((s, w) => s + Math.max(0, Number(w.operatingHours ?? 0)), 0);

  return (
    <>
      <AppHeader back title="Daily operations" eyebrow={ok ? dateLabel(date) : "Choose a date"} />
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        <DateInput label="Date" value={date} onChange={setDate} />
        {q.loading ? (
          <LoadingView />
        ) : q.error ? (
          <ErrorView error={q.error} onRetry={q.reload} />
        ) : (
          <>
            <Grid max={4}>
              <Kpi label="Jobs" value={String(items.length)} icon="assignment" />
              <Kpi label="Working now" value={String(items.filter((w) => w.status === "IN_PROGRESS").length)} tone="success" icon="engineering" />
              <Kpi label="Approved hours" value={`${approvedHours.toFixed(1)} h`} icon="verified" />
              <Kpi label="Awaiting approval" value={`${submittedHours.toFixed(1)} h`} tone={submittedHours ? "warning" : undefined} icon="hourglass-top" />
            </Grid>
            {items.length === 0 && <EmptyView icon="event-busy" title="No jobs on this date" />}
            {GROUPS.map(([label, statuses]) => {
              const g = items.filter((w) => statuses.includes(w.status));
              if (g.length === 0) return null;
              return (
                <View key={label} style={{ gap: 12 }}>
                  <SectionTitle>{`${label} (${g.length})`}</SectionTitle>
                  <Grid max={2}>
                    {g.map((w) => (
                      <WorkOrderCard key={w.id} w={w} />
                    ))}
                  </Grid>
                </View>
              );
            })}
            <Text style={[type.bodySm, { color: color.muted }]}>Hours count as approved only after meter review.</Text>
          </>
        )}
      </Screen>
    </>
  );
}
