import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AppHeader, Banner, Btn, Chips, EmptyView, ErrorView, Icon, LoadingView, Screen, type IconName, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { timeLabel } from "@/lib/format";
import type { NotificationItem } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, radius, space, type } from "@/theme";

const META: Record<string, { icon: IconName; tone: Tone }> = {
  ASSIGNMENT: { icon: "assignment", tone: "info" },
  ASSIGNMENT_UPDATED: { icon: "update", tone: "info" },
  SUBMISSION_RECEIVED: { icon: "cloud-done", tone: "neutral" },
  READING_APPROVED: { icon: "verified", tone: "success" },
  READING_REJECTED: { icon: "report-problem", tone: "danger" },
  PAYROLL_APPROVED: { icon: "receipt-long", tone: "info" },
  PAYROLL_PAID: { icon: "payments", tone: "success" },
  GENERAL: { icon: "campaign", tone: "neutral" },
};
const TONE_COLOR: Record<Tone, string> = { info: color.info, success: color.success, warning: color.warning, danger: color.danger, neutral: color.borderStrong };

export default function Notifications() {
  const router = useRouter();
  const q = useLoad(() => api.notifications());
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [error, setError] = useState<string | null>(null);

  const header = <AppHeader back title="Notifications" />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const items = q.data.items.filter((n) => filter === "all" || !n.readAt);

  const open = async (n: NotificationItem) => {
    if (!n.readAt) api.markRead(n.id).catch(() => undefined);
    if (n.workOrderId) router.push(`/job/${n.workOrderId}`);
    else if (n.type.startsWith("PAYROLL")) router.push("/earnings");
  };

  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        {error && <Banner tone="danger" title="Not updated" body={error} />}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Chips value={filter} onChange={setFilter} options={[{ value: "all", label: "All", count: q.data.items.length }, { value: "unread", label: "Unread", count: q.data.unread }]} />
          </View>
          {q.data.unread > 0 && (
            <Btn compact variant="ghost" icon="done-all" label="Mark all read" onPress={() => api.markAllRead().then(q.refresh, (e) => setError((e as ApiError).message))} />
          )}
        </View>
        {items.length === 0 ? (
          <EmptyView icon="notifications-none" title={filter === "unread" ? "All caught up" : "No notifications yet"} body="Assignments, approvals and corrections will show up here." />
        ) : (
          items.map((n) => {
            const m = META[n.type] ?? META.GENERAL!;
            return (
              <Pressable
                key={n.id}
                onPress={() => open(n)}
                accessibilityRole="button"
                accessibilityLabel={`${n.readAt ? "" : "Unread. "}${n.title}. ${n.body}`}
                style={{ flexDirection: "row", gap: space.md, backgroundColor: n.readAt ? color.white : color.accentSoft, borderWidth: 1, borderColor: color.border, borderLeftWidth: 4, borderLeftColor: TONE_COLOR[m.tone], borderRadius: radius.lg, padding: space.md }}
              >
                <Icon name={m.icon} tint={TONE_COLOR[m.tone] === color.borderStrong ? color.muted : TONE_COLOR[m.tone]} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                    <Text style={[type.labelLg, { color: color.ink, flex: 1 }]}>{n.title}</Text>
                    {!n.readAt && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.accent, marginTop: 5 }} />}
                  </View>
                  <Text style={[type.bodySm, { color: color.navy }]}>{n.body}</Text>
                  <Text style={[type.bodySm, { color: color.muted }]}>{timeLabel(n.createdAt)}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </Screen>
    </>
  );
}
