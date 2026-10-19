import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Grid, ListRow, SearchBar, StatusBadge, useDebounced } from "@/components/kit";
import { AppHeader, Btn, Chips, EmptyView, ErrorView, LoadingView, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { hours, rupees } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";
import { color, space } from "@/theme";

interface DriverRow {
  id: string; driverCode: string; fullName: string; phone: string; status: string; onDuty: boolean; openJobs: number;
  current: { workOrderId: string; code: string; status: string; vehicle: string; siteName: string } | null;
  monthHours: string; monthWorkingDays: number;
  compensation: { method: string; hourlyRate: string | null; monthlySalary: string | null } | null;
}

/** Stitch: admin_driver_list */
export default function Drivers() {
  const router = useRouter();
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const s = useDebounced(search);
  const q = useLoad(() => api.get<DriverRow[]>("/drivers", { search: s, status: status === "all" ? undefined : status }), [s, status]);
  return (
    <>
      <AppHeader back title="Drivers" eyebrow="Operator roster" />
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}><SearchBar value={search} onChange={setSearch} placeholder="Search name, ID or phone" /></View>
          {can("DRIVERS") && <Btn variant="accent" icon="person-add" label="Add" onPress={() => router.push("/more/drivers/edit")} />}
        </View>
        <Chips value={status} onChange={setStatus} options={[{ value: "ACTIVE", label: "Active" }, { value: "ON_LEAVE", label: "On leave" }, { value: "INACTIVE", label: "Inactive" }, { value: "all", label: "All" }]} />
        {q.loading ? (
          <LoadingView />
        ) : !q.data ? (
          <ErrorView error={q.error!} onRetry={q.reload} />
        ) : q.data.length === 0 ? (
          <EmptyView icon="badge" title="No drivers" />
        ) : (
          <Grid max={2}>
            {q.data.map((d) => (
              <ListRow
                key={d.id}
                icon="person"
                accent={d.onDuty ? color.success : undefined}
                title={`${d.fullName} (${d.driverCode})`}
                subtitle={d.current ? `${d.current.code} · ${d.current.vehicle} · ${d.current.siteName}` : `${d.phone} · no open job`}
                meta={`This month: ${hours(d.monthHours)} · ${d.monthWorkingDays} day(s)${d.compensation ? ` · ${d.compensation.method === "HOURLY" ? `${rupees(d.compensation.hourlyRate!)}/h` : `${rupees(d.compensation.monthlySalary!)}/month`}` : ""}`}
                right={<StatusBadge status={d.onDuty ? "WORKING" : d.status} />}
                href={`/more/drivers/${d.id}`}
              />
            ))}
          </Grid>
        )}
      </Screen>
    </>
  );
}
