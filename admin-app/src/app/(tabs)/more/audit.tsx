import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Pager } from "@/components/kit";
import { AppHeader, Card, Chips, EmptyView, ErrorView, LoadingView, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { timeLabel } from "@/lib/format";
import type { Paged } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, font, space, type } from "@/theme";

interface Entry { id: string; action: string; entityType: string; entityId: string; actor: string; reason: string | null; before: unknown; after: unknown; createdAt: string }
const TYPES = ["all", "WorkOrder", "Invoice", "Payment", "PayrollRun", "SalaryAdjustment", "Driver", "Customer", "Vehicle", "TaxRule", "BusinessProfile", "User"];

/** Append-only record of approvals, corrections, rate changes, invoices, payments and permission changes. */
export default function AuditLogScreen() {
  const [entityType, setEntityType] = useState("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useLoad(() => api.get<Paged<Entry>>("/audit-log", { entityType: entityType === "all" ? undefined : entityType, page, pageSize: 30 }), [entityType, page]);
  return (
    <>
      <AppHeader back title="Audit log" eyebrow="Change history" />
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        <Chips value={entityType} onChange={(v) => { setEntityType(v); setPage(1); }} options={TYPES.map((t) => ({ value: t, label: t === "all" ? "All" : t.replace(/([a-z])([A-Z])/g, "$1 $2") }))} />
        {q.loading ? (
          <LoadingView />
        ) : !q.data ? (
          <ErrorView error={q.error!} onRetry={q.reload} />
        ) : q.data.items.length === 0 ? (
          <EmptyView icon="history-edu" title="No entries" />
        ) : (
          <>
            {q.data.items.map((e) => (
              <Pressable key={e.id} onPress={() => setOpen(open === e.id ? null : e.id)} accessibilityRole="button">
                <Card>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                    <Text style={[type.labelLg, { color: color.ink, flex: 1 }]}>{e.action.replace(/[._]/g, " ")}</Text>
                    <Text style={[type.bodySm, { color: color.muted }]}>{timeLabel(e.createdAt)}</Text>
                  </View>
                  <Text style={[type.bodySm, { color: color.muted }]}>{e.actor} · {e.entityType}</Text>
                  {e.reason && <Text style={[type.bodySm, { color: color.navy }]}>Reason: {e.reason}</Text>}
                  {open === e.id && (
                    <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.ink }} selectable>
                      {e.before ? `Before: ${JSON.stringify(e.before, null, 1)}\n` : ""}
                      {e.after ? `After: ${JSON.stringify(e.after, null, 1)}` : ""}
                    </Text>
                  )}
                </Card>
              </Pressable>
            ))}
            <Pager page={page} pageSize={30} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Screen>
    </>
  );
}
