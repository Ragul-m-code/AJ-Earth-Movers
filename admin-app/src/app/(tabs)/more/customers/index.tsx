import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Grid, ListRow, SearchBar, StatusBadge, useDebounced } from "@/components/kit";
import { AppHeader, Btn, Chips, EmptyView, ErrorView, LoadingView, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { rupees } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { color, space } from "@/theme";

interface CustomerRow { id: string; name: string; contactName: string | null; phone: string | null; gstin: string | null; billingCycle: string; active: boolean; sites: number; jobs: number; outstanding: string; overdueCount: number; overdueAmount: string; unbilledJobs: number; unbilledHours: string }

/** Stitch: admin_customer_list */
export default function Customers() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const s = useDebounced(search);
  const q = useLoad(() => api.get<CustomerRow[]>("/customers", { search: s, active: filter === "all" ? undefined : String(filter === "active") }), [s, filter]);
  const sorted = (q.data ?? []).slice().sort((a, b) => b.overdueCount - a.overdueCount || a.name.localeCompare(b.name));
  return (
    <>
      <AppHeader back title="Customers" eyebrow="Client accounts" />
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}><SearchBar value={search} onChange={setSearch} placeholder="Search name, phone or GSTIN" /></View>
          <Btn variant="accent" icon="add" label="Add" onPress={() => router.push("/more/customers/edit")} />
        </View>
        <Chips value={filter} onChange={setFilter} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, { value: "all", label: "All" }]} />
        {q.loading ? (
          <LoadingView />
        ) : !q.data ? (
          <ErrorView error={q.error!} onRetry={q.reload} />
        ) : sorted.length === 0 ? (
          <EmptyView icon="groups" title="No customers" body="Add a customer to start creating work orders." />
        ) : (
          <Grid max={2}>
            {sorted.map((c) => (
              <ListRow
                key={c.id}
                icon="business"
                accent={c.overdueCount ? color.danger : undefined}
                title={c.name}
                subtitle={`${c.contactName ?? "No contact"}${c.phone ? ` · ${c.phone}` : ""} · ${c.sites} site(s) · ${c.jobs} job(s)`}
                meta={[
                  Number(c.outstanding) > 0 && `${rupees(c.outstanding)} outstanding`,
                  c.overdueCount > 0 && `${rupees(c.overdueAmount)} overdue`,
                  c.unbilledJobs > 0 && `${c.unbilledHours} h unbilled`,
                ].filter(Boolean).join(" · ") || undefined}
                right={!c.active ? <StatusBadge status="INACTIVE" /> : c.overdueCount ? <StatusBadge status="OVERDUE" /> : undefined}
                href={`/more/customers/${c.id}`}
              />
            ))}
          </Grid>
        )}
      </Screen>
    </>
  );
}
