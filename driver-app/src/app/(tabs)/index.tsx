import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { JobCard } from "@/components/JobCard";
import { AppHeader, Banner, Btn, Card, EmptyView, ErrorView, Icon, LoadingView, Metric, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, hours, monthLabel, rupees, todayIst } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

const ACTIVE_ORDER = ["IN_PROGRESS", "CORRECTION_REQUIRED", "ACCEPTED", "ASSIGNED"];

export default function Home() {
  const router = useRouter();
  const month = todayIst().slice(0, 7);
  const q = useLoad(() =>
    Promise.all([
      api.me(),
      api.workOrders({ pageSize: 50, from: shiftDays(todayIst(), -30) }),
      api.summary(month),
      api.notifications(),
    ]),
  );

  const header = (
    <AppHeader
      title="Home"
      eyebrow="AJ Driver"
      right={<Bell count={q.data?.[3].unread ?? 0} onPress={() => router.push("/notifications")} />}
    />
  );
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;

  const [me, list, summary] = q.data;
  const today = me.today;
  const open = list.items
    .filter((w) => ACTIVE_ORDER.includes(w.status))
    .sort((a, b) => ACTIVE_ORDER.indexOf(a.status) - ACTIVE_ORDER.indexOf(b.status) || a.workDate.localeCompare(b.workDate));
  const current = open[0];
  const corrections = list.groupCounts.action ?? 0;
  const pending = list.groupCounts.pending ?? 0;
  const todayRow = summary.days.find((d) => d.date === today);
  const recent = list.items.filter((w) => w.status === "APPROVED" || w.status === "PENDING_APPROVAL").slice(0, 3);
  const initials = me.fullName.replace(/\(.*?\)/g, "").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("");

  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        {q.error && <Banner tone="warning" title="Showing earlier data" body={q.error.message} />}

        <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: color.navy, alignItems: "center", justifyContent: "center" }}>
            <Text style={[type.headlineMd, { color: color.accent }]}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.headlineMd, { color: color.ink }]}>Namaste, {me.fullName.split(" ")[0]}</Text>
            <Text style={[type.bodySm, { color: color.muted }]}>
              {me.driverCode} · {dateLabel(today)}
            </Text>
          </View>
        </View>

        {corrections > 0 && (
          <Banner
            tone="danger"
            title={corrections > 1 ? `${corrections} readings need correction` : "1 reading needs correction"}
            body="An admin rejected a meter reading. Fix it so the hours can be approved."
            action={<Btn compact variant="danger" label="Open My Work" onPress={() => router.push({ pathname: "/work", params: { group: "action" } })} />}
          />
        )}
        {pending > 0 && (
          <Banner tone="warning" icon="hourglass-top" title={`${pending} job${pending > 1 ? "s" : ""} awaiting admin approval`} body="Pending hours are not counted for pay until approved." />
        )}

        <SectionTitle icon="work-outline">{current ? "Current job" : "Assignments"}</SectionTitle>
        {current ? (
          <JobCard wo={current} />
        ) : (
          <Card>
            <EmptyView icon="event-available" title="No active assignment" body="New jobs from dispatch appear here and in My Work. Pull down to refresh." />
          </Card>
        )}
        {open.length > 1 && (
          <Btn variant="outline" label={`See all ${open.length} open jobs`} onPress={() => router.push("/work")} />
        )}

        <SectionTitle icon="schedule">Today’s hours</SectionTitle>
        <View style={{ flexDirection: "row", gap: space.md }}>
          <Card style={{ flex: 1 }}>
            <Metric label="Approved" value={Number(todayRow?.approvedHours ?? 0).toFixed(1)} unit="h" tone="success" sub="Counted for pay" />
          </Card>
          <Card style={{ flex: 1 }}>
            <Metric label="Pending approval" value={Number(todayRow?.pendingHours ?? 0).toFixed(1)} unit="h" tone="warning" sub="Not yet counted" />
          </Card>
        </View>

        <SectionTitle icon="calendar-month" right={<Text style={[type.labelMd, { color: color.muted }]}>{monthLabel(month)}</Text>}>This month</SectionTitle>
        <Card>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Metric label="Approved hours" value={Number(summary.approvedHours).toFixed(1)} />
            <Metric label="Working days" value={String(summary.workingDays)} sub="Distinct dates" />
          </View>
          <View style={{ height: 1, backgroundColor: color.border, marginVertical: space.sm }} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
            <View>
              <Text style={[type.labelSm, { color: color.muted }]}>Earnings from approved hours</Text>
              <Text style={[type.displaySm, { color: color.ink }]}>{rupees(summary.approvedEarnings)}</Text>
              <Text style={[type.bodySm, { color: color.muted }]}>Before adjustments. Final pay is set in payroll.</Text>
            </View>
          </View>
          <Btn compact variant="outline" label="Earnings & salary history" icon="account-balance-wallet" onPress={() => router.push("/earnings")} />
        </Card>

        <SectionTitle icon="history" right={<Pressable accessibilityRole="link" onPress={() => router.push("/work")} hitSlop={12}><Text style={[type.labelLg, { color: color.navy, fontFamily: font.bold }]}>View all</Text></Pressable>}>
          Recent submissions
        </SectionTitle>
        {recent.length === 0 ? (
          <Text style={[type.bodyMd, { color: color.muted }]}>No submissions yet.</Text>
        ) : (
          recent.map((w) => (
            <Pressable key={w.id} onPress={() => router.push(`/job/${w.id}`)} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: color.white, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space.md }}>
              <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.recessed, alignItems: "center", justifyContent: "center" }}>
                <Icon name={w.status === "APPROVED" ? "check-circle" : "hourglass-top"} tint={w.status === "APPROVED" ? color.success : color.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.labelLg, { color: color.ink }]}>{w.code}</Text>
                <Text style={[type.bodySm, { color: color.muted }]} numberOfLines={1}>
                  {dateLabel(w.workDate)} · {w.operatingHours ? hours(w.operatingHours) : "—"} · {w.siteName}
                </Text>
              </View>
              <Text style={[type.labelMd, { color: w.status === "APPROVED" ? color.successText : color.warningText }]}>
                {w.status === "APPROVED" && w.approved ? rupees(w.approved.driverAmount) : "Pending"}
              </Text>
            </Pressable>
          ))
        )}

        <Pressable onPress={() => router.push("/help")} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md }}>
          <Icon name="support-agent" tint={color.muted} />
          <Text style={[type.labelLg, { color: color.navy, flex: 1 }]}>Help & dispatch contacts</Text>
          <Icon name="chevron-right" tint={color.muted} />
        </Pressable>
      </Screen>
    </>
  );
}

function Bell({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Notifications, ${count} unread`} onPress={onPress} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Icon name="notifications-none" />
      {count > 0 && (
        <View style={{ position: "absolute", top: 6, right: 6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: color.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
          <Text style={{ fontFamily: font.extrabold, fontSize: 10, color: color.navy }}>{count > 9 ? "9+" : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

function shiftDays(ymd: string, days: number) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
