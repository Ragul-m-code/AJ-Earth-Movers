import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFlash } from "@/components/kit";
import { AppHeader, Btn, Chips, EmptyView, ErrorView, Icon, LoadingView, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { timeLabel } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { color, radius, space, type } from "@/theme";

interface Item { id: string; type: string; title: string; body: string; workOrderId: string | null; readAt: string | null; createdAt: string }

/** Stitch: admin_notifications */
export default function AdminNotifications() {
  const router = useRouter();
  const flash = useFlash();
  const [filter, setFilter] = useState("all");
  const q = useLoad(() => api.get<{ unread: number; items: Item[] }>("/notifications"));
  if (q.loading) return <><AppHeader back title="Notifications" /><LoadingView /></>;
  if (!q.data) return <><AppHeader back title="Notifications" /><ErrorView error={q.error!} onRetry={q.reload} /></>;
  const items = q.data.items.filter((n) => filter === "all" || !n.readAt);
  const open = (n: Item) => {
    if (!n.readAt) api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    if (n.workOrderId) router.push(n.type === "METER_SUBMITTED" ? `/work/review/${n.workOrderId}` : `/work/${n.workOrderId}`);
  };
  return (
    <>
      <AppHeader back title="Notifications" />
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        {flash.node}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <View style={{ flex: 1 }}><Chips value={filter} onChange={setFilter} options={[{ value: "all", label: "All", count: q.data.items.length }, { value: "unread", label: "Unread", count: q.data.unread }]} /></View>
          {q.data.unread > 0 && <Btn compact variant="ghost" icon="done-all" label="Mark all read" onPress={() => api.post("/notifications/read-all").then(q.refresh, (e) => flash.fail(e))} />}
        </View>
        {items.length === 0 ? (
          <EmptyView icon="notifications-none" title={filter === "unread" ? "All caught up" : "No notifications"} body="Driver meter submissions and alerts appear here." />
        ) : (
          items.map((n) => (
            <Pressable key={n.id} onPress={() => open(n)} accessibilityRole="button" style={{ flexDirection: "row", gap: space.md, backgroundColor: n.readAt ? color.white : color.accentSoft, borderWidth: 1, borderColor: color.border, borderLeftWidth: 4, borderLeftColor: n.type === "METER_SUBMITTED" ? color.warning : color.info, borderRadius: radius.lg, padding: space.md }}>
              <Icon name={n.type === "METER_SUBMITTED" ? "fact-check" : "notifications"} tint={color.navy} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.labelLg, { color: color.ink }]}>{n.title}</Text>
                <Text style={[type.bodySm, { color: color.navy }]}>{n.body}</Text>
                <Text style={[type.bodySm, { color: color.muted }]}>{timeLabel(n.createdAt)}</Text>
              </View>
            </Pressable>
          ))
        )}
      </Screen>
    </>
  );
}
