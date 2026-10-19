import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { Grid, ListRow, Pager, SearchBar, Segmented, StatusBadge, useDebounced } from "@/components/kit";
import { WorkOrderCard } from "@/components/WorkOrderCard";
import { AppHeader, Banner, Btn, Card, Chips, EmptyView, ErrorView, LoadingView, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, meter, timeLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { FLAG_TEXT, type Paged, type WorkOrderItem } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

type View_ = "orders" | "approvals" | "history";
const ORDER_FILTERS = [
  { value: "open", label: "Open" },
  { value: "PENDING_APPROVAL", label: "Pending approval" },
  { value: "CORRECTION_REQUIRED", label: "Correction" },
  { value: "APPROVED", label: "Approved" },
  { value: "DECLINED", label: "Declined" },
  { value: "all", label: "All" },
] as const;

export default function WorkHub() {
  const params = useLocalSearchParams<{ view?: View_ }>();
  const router = useRouter();
  const { can } = useSession();
  const [chosen, setChosen] = useState<{ v: View_; from?: string }>({ v: params.view ?? "orders", from: params.view });
  const view = params.view && params.view !== chosen.from ? params.view : chosen.v;
  const setView = (v: View_) => setChosen({ v, from: params.view });

  return (
    <>
      <AppHeader title="Work" eyebrow="Work orders & meter approvals" />
      <Screen>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "orders", label: "Work orders" },
            ...(can("METER_APPROVAL") ? [{ value: "approvals" as const, label: "Approvals" }, { value: "history" as const, label: "History" }] : []),
          ]}
        />
        {view === "orders" ? <Orders /> : view === "approvals" ? <Approvals /> : <History />}
      </Screen>
      {view === "orders" && can("WORK_ORDERS") ? (
        <View style={{ position: "absolute", right: space.gutter, bottom: space.lg }}>
          <Btn variant="accent" icon="add" label="Create work order" onPress={() => router.push("/work/new")} />
        </View>
      ) : null}
    </>
  );
}

function Orders() {
  const [filter, setFilter] = useState<(typeof ORDER_FILTERS)[number]["value"]>("open");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const status = filter === "open" || filter === "all" ? undefined : [filter];
  const list = useLoad(
    () => api.get<Paged<WorkOrderItem> & { statusCounts: Record<string, number> }>("/work-orders", { status, open: filter === "open" ? "true" : undefined, q, page, pageSize: 20 }),
    [filter, q, page],
  );
  const counts = list.data?.statusCounts ?? {};
  const openCount = (counts.ASSIGNED ?? 0) + (counts.ACCEPTED ?? 0) + (counts.IN_PROGRESS ?? 0);

  return (
    <>
      <SearchBar value={search} onChange={(s) => { setSearch(s); setPage(1); }} placeholder="Search WO, customer, site, driver or machine" />
      <Chips
        value={filter}
        onChange={(v) => { setFilter(v); setPage(1); }}
        options={ORDER_FILTERS.map((f) => ({ ...f, count: f.value === "open" ? openCount : f.value === "all" ? undefined : counts[f.value] ?? 0 }))}
      />
      {list.loading ? (
        <LoadingView />
      ) : !list.data ? (
        <ErrorView error={list.error!} onRetry={list.reload} />
      ) : list.data.items.length === 0 ? (
        <EmptyView icon="assignment" title="No work orders" body={q ? `Nothing matches “${q}”.` : "Create a work order to assign a machine and driver."} />
      ) : (
        <>
          <Text style={[type.labelMd, { color: color.muted }]}>{list.data.total} work order(s)</Text>
          <Grid max={2}>
            {list.data.items.map((w) => (
              <WorkOrderCard key={w.id} w={w} />
            ))}
          </Grid>
          <Pager page={page} pageSize={20} total={list.data.total} onPage={setPage} />
        </>
      )}
      <View style={{ height: 64 }} />
    </>
  );
}

function Approvals() {
  const router = useRouter();
  const list = useLoad(() => api.get<Paged<WorkOrderItem>>("/work-orders", { status: ["PENDING_APPROVAL"], sort: "submittedAt", pageSize: 50 }));
  if (list.loading) return <LoadingView />;
  if (!list.data) return <ErrorView error={list.error!} onRetry={list.reload} />;
  const items = list.data.items;
  const flagged = items.filter((w) => w.flags.length > 0);
  const totalHours = items.reduce((s, w) => s + Math.max(0, Number(w.operatingHours ?? 0)), 0);
  return (
    <>
      <View style={{ backgroundColor: color.navy, borderRadius: radius.xl, padding: space.lg, gap: space.sm }}>
        <Text style={[type.headlineLg, { color: color.white }]}>{items.length} pending submission(s)</Text>
        <Text style={[type.bodyMd, { color: "#C9D6E3" }]}>
          {flagged.length} flagged for attention · {totalHours.toFixed(1)} h awaiting verification
        </Text>
        <Text style={[type.bodySm, { color: "#C9D6E3" }]}>Nothing is billed or paid until you approve it. Compare each reading with its photo.</Text>
      </View>
      {items.length === 0 ? (
        <EmptyView icon="task-alt" title="All caught up" body="New driver submissions appear here." />
      ) : (
        <Grid max={2}>
          {[...flagged, ...items.filter((w) => w.flags.length === 0)].map((w) => (
            <Card key={w.id} accent={w.flags.length ? color.danger : color.warning}>
              <View style={{ paddingLeft: 6, gap: space.sm }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                  <Text style={[type.labelSm, { color: w.flags.length ? color.dangerText : color.warningText }]}>{w.flags.length ? "Needs review · flagged" : "Pending approval"}</Text>
                  {w.submittedAt && <Text style={[type.bodySm, { color: color.muted }]}>{timeLabel(w.submittedAt)}</Text>}
                </View>
                <Text style={[type.headlineSm, { color: color.ink, fontFamily: font.bold }]}>{w.vehicle.make} {w.vehicle.model} ({w.vehicle.unitCode})</Text>
                <Text style={[type.bodySm, { color: color.muted }]}>{w.code} · {w.driver.fullName} · {w.siteName}</Text>
                <View style={{ backgroundColor: color.navy, borderRadius: radius.md, padding: space.md, flexDirection: "row", gap: space.md }}>
                  <Meter label="Start" value={w.start ? meter(w.start.value) : "—"} />
                  <Meter label="End" value={w.end ? meter(w.end.value) : "—"} />
                  <Meter label="Hours" value={w.operatingHours ?? "—"} danger={Number(w.operatingHours) < 0} />
                </View>
                {w.flags.map((f) => (
                  <Text key={f} style={[type.bodySm, { color: color.dangerText }]}>⚠ {FLAG_TEXT[f] ?? f}</Text>
                ))}
                <Btn variant={w.flags.length ? "danger" : "accent"} icon="fact-check" label={w.flags.length ? "Investigate & review" : "Review & approve"} onPress={() => router.push(`/work/review/${w.id}`)} />
              </View>
            </Card>
          ))}
        </Grid>
      )}
    </>
  );
}

function Meter({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[type.labelSm, { color: "#9FB3C8" }]}>{label}</Text>
      <Text style={{ fontFamily: font.extrabold, fontSize: 20, color: danger ? "#FCA5A5" : color.accent, fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}

function History() {
  const [page, setPage] = useState(1);
  const list = useLoad(() => api.get<Paged<WorkOrderItem>>("/work-orders", { status: ["APPROVED", "CORRECTION_REQUIRED"], page, pageSize: 25 }), [page]);
  if (list.loading) return <LoadingView />;
  if (!list.data) return <ErrorView error={list.error!} onRetry={list.reload} />;
  return (
    <>
      <Banner tone="info" title="Approval history" body="Every decision is kept with the reviewer, time, reason and any authorized correction. Open a job for its full audit trail." />
      {list.data.items.length === 0 ? (
        <EmptyView icon="history" title="No decisions yet" />
      ) : (
        list.data.items.map((w) => (
          <ListRow
            key={w.id}
            accent={w.status === "APPROVED" ? color.success : color.danger}
            title={`${w.code} · ${w.vehicle.unitCode} · ${w.driver.fullName}`}
            subtitle={w.status === "APPROVED" ? `Approved ${w.approved?.hours ?? w.operatingHours} h · ${dateLabel(w.workDate)}` : `Rejected: ${w.latestReview?.reason ?? ""}`}
            meta={w.latestReview ? `Decided ${timeLabel(w.latestReview.createdAt)}` : undefined}
            right={<StatusBadge status={w.status} />}
            href={`/work/${w.id}`}
          />
        ))
      )}
      <Pager page={page} pageSize={25} total={list.data.total} onPage={setPage} />
    </>
  );
}
