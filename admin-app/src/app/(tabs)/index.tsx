import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Grid, Kpi, ListRow, StatusBadge } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, EmptyView, ErrorView, Icon, LoadingView, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, hours, rupees, timeLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { bytesLabel, type StorageUsage } from "@/lib/storage";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

interface Dashboard {
  today: string;
  storage: StorageUsage | null;
  fleet: { total: number; working: number; maintenance: number; available: number };
  jobs: { inProgress: number; pendingApproval: number; correctionRequired: number; today: number };
  month: { approvedHours: string; approvedJobs: number };
  unbilled: { jobs: number; hours: string };
  receivables: { outstanding: string; overdueAmount: string; overdueCount: number; topOverdue: { invoiceId: string; number: string; customer: string; balance: string; dueDate: string | null }[] } | null;
  maintenanceDueSoon: number;
  pendingReviews: { workOrderId: string; code: string; vehicle: string; driverName: string; hours: string | null; submittedAt: string | null }[];
  todayJobs: { workOrderId: string; code: string; status: string; vehicle: string; unitCode: string; driverName: string; customerName: string; siteName: string }[];
}

function greeting() {
  const h = Number(new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 13));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function DashboardScreen() {
  const router = useRouter();
  const { user, can } = useSession();
  const q = useLoad(() => Promise.all([api.get<Dashboard>("/dashboard"), api.get<{ unread: number }>("/notifications", { unread: "true" })]));

  const header = (
    <AppHeader
      title="Dashboard"
      eyebrow="AJ Earth Movers · Control"
      right={
        <Pressable accessibilityRole="button" accessibilityLabel={`Notifications, ${q.data?.[1].unread ?? 0} unread`} onPress={() => router.push("/more/notifications")} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <Icon name="notifications-none" />
          {(q.data?.[1].unread ?? 0) > 0 && (
            <View style={{ position: "absolute", top: 6, right: 6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: color.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
              <Text style={{ fontFamily: font.extrabold, fontSize: 10, color: color.navy }}>{q.data![1].unread > 9 ? "9+" : q.data![1].unread}</Text>
            </View>
          )}
        </Pressable>
      }
    />
  );
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const [d] = q.data;

  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        {q.error && <Banner tone="warning" title="Showing earlier data" body={q.error.message} />}
        {d.storage && (
          <Banner
            tone={d.storage.level === "critical" ? "danger" : "warning"}
            icon="sd-storage"
            title={d.storage.level === "critical" ? "Photo storage almost full" : "Photo storage above 80%"}
            body={`${bytesLabel(d.storage.usedBytes)} of ${bytesLabel(d.storage.quotaBytes)} used (${d.storage.percent}%). Increase the storage plan, then raise the quota in Operational settings. Photos keep uploading.`}
            action={<Btn compact variant="outline" label="Storage settings" onPress={() => router.push("/more/settings/app")} />}
          />
        )}
        <View>
          <Text style={[type.headlineLg, { color: color.ink }]}>{greeting()}, {user?.displayName.split(" ")[0]}</Text>
          <Text style={[type.bodyMd, { color: color.muted }]}>{dateLabel(d.today)}</Text>
        </View>

        <SectionTitle icon="insights">Overview</SectionTitle>
        <Grid max={4}>
          <Kpi label="Active fleet" value={`${d.fleet.working}/${d.fleet.total}`} sub={`${d.fleet.working} working · ${d.fleet.available} free · ${d.fleet.maintenance} in workshop`} icon="construction" onPress={() => router.push("/fleet")} />
          <Kpi label="Meter approvals" value={String(d.jobs.pendingApproval)} sub={d.jobs.correctionRequired ? `${d.jobs.correctionRequired} awaiting driver correction` : "Awaiting review"} tone={d.jobs.pendingApproval ? "warning" : undefined} icon="fact-check" onPress={() => router.push({ pathname: "/work", params: { view: "approvals" } })} />
          {d.receivables ? (
            <Kpi label="Overdue" value={rupees(d.receivables.overdueAmount)} sub={`${d.receivables.overdueCount} invoice(s) · ${rupees(d.receivables.outstanding)} outstanding`} tone={d.receivables.overdueCount ? "danger" : undefined} icon="warning-amber" onPress={() => router.push({ pathname: "/finance", params: { view: "invoices", status: "OVERDUE" } })} />
          ) : (
            <Kpi label="Jobs today" value={String(d.jobs.today)} sub={`${d.jobs.inProgress} in progress`} icon="today" />
          )}
          <Kpi label="Approved, not invoiced" value={hours(d.unbilled.hours)} sub={`${d.unbilled.jobs} work record(s). Approved work is not revenue until invoiced.`} icon="pending-actions" onPress={can("INVOICES") ? () => router.push("/finance/invoice/new") : undefined} />
        </Grid>

        <Grid max={3}>
          {can("WORK_ORDERS") && <Btn variant="accent" icon="add-circle-outline" label="New work order" onPress={() => router.push("/work/new")} />}
          {can("METER_APPROVAL") && <Btn variant="outline" icon="verified" label="Verify meters" onPress={() => router.push({ pathname: "/work", params: { view: "approvals" } })} />}
          {can("INVOICES") && <Btn variant="outline" icon="request-quote" label="Billing" onPress={() => router.push("/finance")} />}
        </Grid>

        <SectionTitle icon="priority-high" right={<Text style={[type.labelMd, { color: color.warningText }]}>{d.pendingReviews.length + (d.receivables?.topOverdue.length ?? 0)} item(s)</Text>}>
          Needs attention
        </SectionTitle>
        {d.pendingReviews.length === 0 && !d.receivables?.topOverdue.length && d.maintenanceDueSoon === 0 ? (
          <Card><EmptyView icon="task-alt" title="Nothing waiting" body="New meter submissions and overdue invoices appear here." /></Card>
        ) : null}
        <Grid max={2}>
          {d.pendingReviews.map((p) => (
            <Card key={p.workOrderId} accent={color.warning}>
              <View style={{ paddingLeft: 6, gap: space.sm }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                  <Text style={[type.labelLg, { color: color.ink, flex: 1 }]}>Meter sign-off · {p.code}</Text>
                  {p.hours && <Text style={[type.labelMd, { color: Number(p.hours) < 0 ? color.dangerText : color.warningText }]}>{Number(p.hours) >= 0 ? "+" : ""}{p.hours} h</Text>}
                </View>
                <Text style={[type.bodySm, { color: color.muted }]}>{p.vehicle} · {p.driverName}{p.submittedAt ? ` · ${timeLabel(p.submittedAt)}` : ""}</Text>
                <Btn compact variant="dark" label="Review" icon="fact-check" onPress={() => router.push(`/work/review/${p.workOrderId}`)} />
              </View>
            </Card>
          ))}
          {d.receivables?.topOverdue.map((o) => (
            <Card key={o.invoiceId} accent={color.danger}>
              <View style={{ paddingLeft: 6, gap: space.sm }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={[type.labelLg, { color: color.ink }]}>{rupees(o.balance)} overdue</Text>
                  <StatusBadge status="OVERDUE" />
                </View>
                <Text style={[type.bodySm, { color: color.muted }]}>{o.customer} · {o.number}{o.dueDate ? ` · due ${dateLabel(o.dueDate)}` : ""}</Text>
                <Btn compact variant="outline" label="View invoice" onPress={() => router.push(`/finance/invoice/${o.invoiceId}`)} />
              </View>
            </Card>
          ))}
          {d.maintenanceDueSoon > 0 && (
            <ListRow icon="build" title={`${d.maintenanceDueSoon} service(s) due within 7 days`} subtitle="Plan workshop time before assigning these machines." href={{ pathname: "/fleet", params: { view: "maintenance" } }} />
          )}
        </Grid>

        <SectionTitle icon="today" right={<Pressable onPress={() => router.push("/work/daily")} accessibilityRole="link" hitSlop={10}><Text style={[type.labelLg, { color: color.navy, fontFamily: font.bold }]}>Daily operations ›</Text></Pressable>}>
          Today&apos;s jobs ({d.todayJobs.length})
        </SectionTitle>
        {d.todayJobs.length === 0 ? (
          <Text style={[type.bodyMd, { color: color.muted }]}>No jobs scheduled today.</Text>
        ) : (
          <Grid max={2}>
            {d.todayJobs.map((j) => (
              <ListRow key={j.workOrderId} icon="construction" title={`${j.vehicle} (${j.unitCode})`} subtitle={`${j.siteName} · ${j.customerName} · ${j.driverName}`} meta={j.code} right={<StatusBadge status={j.status} />} href={`/work/${j.workOrderId}`} />
            ))}
          </Grid>
        )}
        <View style={{ flexDirection: "row", gap: space.sm, backgroundColor: color.recessed, padding: space.md, borderRadius: radius.lg }}>
          <Icon name="info-outline" size={18} tint={color.muted} />
          <Text style={[type.bodySm, { color: color.muted, flex: 1 }]}>
            This month: {hours(d.month.approvedHours)} approved across {d.month.approvedJobs} job(s). Pending and rejected submissions are not counted.
          </Text>
        </View>
      </Screen>
    </>
  );
}
