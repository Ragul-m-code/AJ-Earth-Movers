import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { ConfirmDialog, Grid, Kpi, ListRow, SearchBar, Segmented, StatusBadge, useDebounced, useFlash } from "@/components/kit";
import { AppHeader, Btn, Card, Chips, EmptyView, ErrorView, Icon, LoadingView, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, meter, rupees } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

type Tab = "machines" | "attachments" | "maintenance";
interface VehicleRow {
  id: string;
  unitCode: string;
  registrationNo: string;
  make: string;
  model: string;
  category: string;
  status: string;
  lastApprovedMeter: string | null;
  defaultRate: string | null;
  current: { workOrderId: string; code: string; siteName: string; driverName: string; customerName: string; workDate: string } | null;
  nextMaintenance: { title: string; scheduledOn: string | null; status: string } | null;
  insuranceExpiry: string | null;
}

export default function FleetHub() {
  const params = useLocalSearchParams<{ view?: Tab }>();
  const { can } = useSession();
  const [chosen, setChosen] = useState<{ v: Tab; from?: string }>({ v: params.view ?? "machines", from: params.view });
  const tab = params.view && params.view !== chosen.from ? params.view : chosen.v;
  return (
    <>
      <AppHeader title="Fleet" eyebrow="Machines, attachments & maintenance" />
      <Screen>
        <Segmented
          value={tab}
          onChange={(v) => setChosen({ v, from: params.view })}
          options={[{ value: "machines", label: "Machines" }, { value: "attachments", label: "Attachments" }, ...(can("MAINTENANCE") ? [{ value: "maintenance" as const, label: "Maintenance" }] : [])]}
        />
        {tab === "machines" ? <Machines /> : tab === "attachments" ? <Attachments /> : <Maintenance />}
      </Screen>
    </>
  );
}

function Machines() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const s = useDebounced(search);
  const q = useLoad(() => api.get<{ items: VehicleRow[]; total: number; statusCounts: Record<string, number> }>("/vehicles", { search: s, status: status === "all" ? undefined : status }), [s, status]);
  const c = q.data?.statusCounts ?? {};
  return (
    <>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}><SearchBar value={search} onChange={setSearch} placeholder="Search unit, registration, model" /></View>
        <Btn variant="accent" icon="add" label="Add" onPress={() => router.push("/fleet/vehicle/edit")} />
      </View>
      <Chips
        value={status}
        onChange={setStatus}
        options={[
          { value: "all", label: "All", count: q.data?.total },
          { value: "AVAILABLE", label: "Available", count: c.AVAILABLE ?? 0 },
          { value: "ASSIGNED", label: "Assigned", count: c.ASSIGNED ?? 0 },
          { value: "WORKING", label: "Working", count: c.WORKING ?? 0 },
          { value: "MAINTENANCE", label: "Maintenance", count: c.MAINTENANCE ?? 0 },
          { value: "INACTIVE", label: "Inactive", count: c.INACTIVE ?? 0 },
        ]}
      />
      {q.loading ? (
        <LoadingView />
      ) : !q.data ? (
        <ErrorView error={q.error!} onRetry={q.reload} />
      ) : q.data.items.length === 0 ? (
        <EmptyView icon="construction" title="No machines" body="Add a machine to start assigning work." />
      ) : (
        <Grid max={2}>
          {q.data.items.map((v) => (
            <Card key={v.id} padded={false}>
              <View style={{ padding: space.md, gap: space.sm }}>
                <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
                  <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.recessed, alignItems: "center", justifyContent: "center" }}>
                    <Icon name="construction" />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.headlineSm, { color: color.ink, fontFamily: font.bold }]} numberOfLines={1}>{v.make} {v.model}</Text>
                    <Text style={[type.bodySm, { color: color.muted }]}>{v.unitCode} · {v.registrationNo} · {v.category}</Text>
                  </View>
                  <StatusBadge status={v.status} />
                </View>
                {v.current && <Text style={[type.bodySm, { color: color.navy }]}>{v.current.code} · {v.current.siteName} · {v.current.driverName} ({dateLabel(v.current.workDate)})</Text>}
                <View style={{ flexDirection: "row", gap: space.lg }}>
                  <Text style={[type.bodySm, { color: color.muted }]}>Meter: {v.lastApprovedMeter ? `${meter(v.lastApprovedMeter)} h` : "—"}</Text>
                  <Text style={[type.bodySm, { color: color.muted }]}>Default: {v.defaultRate ? `${rupees(v.defaultRate)}/h` : "no rate"}</Text>
                </View>
                {v.nextMaintenance && <Text style={[type.bodySm, { color: color.warningText }]}>Service: {v.nextMaintenance.title}{v.nextMaintenance.scheduledOn ? ` · ${dateLabel(v.nextMaintenance.scheduledOn)}` : ""}</Text>}
                <Btn compact variant="outline" label="Machine details" onPress={() => router.push(`/fleet/vehicle/${v.id}`)} />
              </View>
            </Card>
          ))}
        </Grid>
      )}
    </>
  );
}

interface AttachmentRow { id: string; code: string; name: string; type: string; chargeable: boolean; active: boolean; defaultRate: string | null; inUse: boolean }

function Attachments() {
  const router = useRouter();
  const q = useLoad(() => api.get<AttachmentRow[]>("/attachments"));
  if (q.loading) return <LoadingView />;
  if (!q.data) return <ErrorView error={q.error!} onRetry={q.reload} />;
  return (
    <>
      <Btn variant="accent" icon="add" label="Add attachment" onPress={() => router.push("/fleet/attachment/edit")} />
      {q.data.length === 0 ? (
        <EmptyView icon="hardware" title="No attachments" body="Register breakers, buckets and other attachments." />
      ) : (
        <Grid max={2}>
          {q.data.map((a) => (
            <ListRow
              key={a.id}
              icon="hardware"
              title={`${a.name} (${a.code})`}
              subtitle={`${a.type} · ${a.chargeable ? `billable${a.defaultRate ? ` · default ${rupees(a.defaultRate)}/h` : " · no default rate"}` : "not billable"}`}
              right={a.active ? (a.inUse ? <StatusBadge status="WORKING" /> : <StatusBadge status="AVAILABLE" />) : <StatusBadge status="INACTIVE" />}
              href={`/fleet/attachment/${a.id}`}
            />
          ))}
        </Grid>
      )}
    </>
  );
}

interface MaintenanceRow { id: string; vehicle: { id: string; unitCode: string; make: string; model: string }; title: string; category: string; status: string; scheduledOn: string | null; cost: string | null; vendor: string | null; downtimeHours: number | null }

function Maintenance() {
  const router = useRouter();
  const flash = useFlash();
  const [filter, setFilter] = useState("open");
  const [act, setAct] = useState<{ m: MaintenanceRow; to: "IN_PROGRESS" | "COMPLETED" | "CANCELLED" } | null>(null);
  const q = useLoad(() => api.get<{ items: MaintenanceRow[]; completedCost: string }>("/maintenance"));
  if (q.loading) return <LoadingView />;
  if (!q.data) return <ErrorView error={q.error!} onRetry={q.reload} />;
  const items = q.data.items.filter((m) => (filter === "open" ? m.status === "SCHEDULED" || m.status === "IN_PROGRESS" : m.status === filter));
  return (
    <>
      {flash.node}
      <Grid max={3}>
        <Kpi label="In workshop" value={String(q.data.items.filter((m) => m.status === "IN_PROGRESS").length)} tone="warning" icon="build" />
        <Kpi label="Scheduled" value={String(q.data.items.filter((m) => m.status === "SCHEDULED").length)} icon="event" />
        <Kpi label="Completed cost" value={rupees(q.data.completedCost)} icon="payments" />
      </Grid>
      <Btn variant="accent" icon="add" label="Add maintenance record" onPress={() => router.push("/fleet/maintenance/new")} />
      <Chips value={filter} onChange={setFilter} options={[{ value: "open", label: "Open" }, { value: "COMPLETED", label: "Completed" }, { value: "CANCELLED", label: "Cancelled" }]} />
      {items.length === 0 ? (
        <EmptyView icon="build" title="Nothing here" />
      ) : (
        <Grid max={2}>
          {items.map((m) => (
            <Card key={m.id} accent={m.status === "IN_PROGRESS" ? color.warning : m.status === "SCHEDULED" ? color.info : color.borderStrong}>
              <View style={{ paddingLeft: 6, gap: space.sm }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                  <Text style={[type.labelLg, { color: color.ink, flex: 1 }]}>{m.title}</Text>
                  <StatusBadge status={m.status} />
                </View>
                <Text style={[type.bodySm, { color: color.muted }]}>
                  {m.vehicle.unitCode} · {m.vehicle.make} {m.vehicle.model} · {m.category}
                  {m.scheduledOn ? ` · ${dateLabel(m.scheduledOn)}` : ""}
                </Text>
                {(m.cost || m.vendor || m.downtimeHours !== null) && (
                  <Text style={[type.bodySm, { color: color.navy }]}>
                    {[m.cost && rupees(m.cost), m.vendor, m.downtimeHours !== null && `${m.downtimeHours} h downtime`].filter(Boolean).join(" · ")}
                  </Text>
                )}
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  {m.status === "SCHEDULED" && <Btn compact variant="dark" label="Start (machine to workshop)" onPress={() => setAct({ m, to: "IN_PROGRESS" })} />}
                  {m.status === "SCHEDULED" && <Btn compact variant="ghost" label="Cancel" onPress={() => setAct({ m, to: "CANCELLED" })} />}
                  {m.status === "IN_PROGRESS" && <Btn compact variant="accent" label="Mark completed" onPress={() => setAct({ m, to: "COMPLETED" })} />}
                </View>
              </View>
            </Card>
          ))}
        </Grid>
      )}
      <ConfirmDialog
        visible={!!act}
        title={act?.to === "IN_PROGRESS" ? "Send machine to workshop?" : act?.to === "COMPLETED" ? "Mark maintenance completed?" : "Cancel this maintenance?"}
        body={act?.to === "IN_PROGRESS" ? "The machine is set to Maintenance and cannot be assigned until this is completed." : act?.to === "COMPLETED" ? "The machine returns to Available." : undefined}
        confirmLabel="Confirm"
        onCancel={() => setAct(null)}
        onConfirm={async () => {
          await api.post(`/maintenance/${act!.m.id}/status`, { status: act!.to });
          setAct(null);
          flash.ok("Maintenance updated");
          await q.refresh();
        }}
      />
    </>
  );
}
