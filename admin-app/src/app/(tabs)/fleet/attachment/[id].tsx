import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { ConfirmDialog, DateInput, Grid, InfoGrid, isMoney, isValidDate, Kpi, ListRow, MoneyInput, StatusBadge, useFlash } from "@/components/kit";
import { AppHeader, Btn, Card, ErrorView, LoadingView, Row, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, hours, rupees, todayIst } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

interface AttachmentDetail {
  id: string; code: string; name: string; type: string; chargeable: boolean; active: boolean; notes: string | null;
  rates: { hourlyCharge: string; effectiveFrom: string }[];
  totalBilledHours: string;
  usage: { workOrderId: string; code: string; workDate: string; customerName: string; vehicle: string; hours: string }[];
}

/** Attachment profile, surcharge history and billed usage (Stitch: admin_attachment_details). */
export default function AttachmentDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const flash = useFlash();
  const q = useLoad(() => api.get<AttachmentDetail>(`/attachments/${id}`), [id]);
  const [rateOpen, setRateOpen] = useState(false);
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState(todayIst());

  const header = <AppHeader back title={q.data?.name ?? "Attachment"} eyebrow={q.data?.code} />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const a = q.data;
  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        {flash.node}
        <Card accent={a.chargeable ? color.accent : color.borderStrong}>
          <View style={{ paddingLeft: 6, gap: space.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={[type.headlineLg, { color: color.ink, flex: 1 }]}>{a.name}</Text>
              <StatusBadge status={a.active ? "ACTIVE" : "INACTIVE"} />
            </View>
            <InfoGrid items={[["Code", a.code], ["Type", a.type], ["Billing", a.chargeable ? "Billable surcharge on approved breaker hours" : "Not billable"], ["Notes", a.notes]]} />
            <Btn compact variant="outline" icon="edit" label="Edit" onPress={() => router.push({ pathname: "/fleet/attachment/edit", params: { id: a.id } })} />
          </View>
        </Card>
        <Grid max={2}>
          <Kpi label="Billed breaker hours (all time)" value={hours(a.totalBilledHours)} />
          <Kpi label="Current default surcharge" value={a.rates[0] ? `${rupees(a.rates[0].hourlyCharge)}/h` : "Not set"} tone={a.chargeable && !a.rates[0] ? "danger" : undefined} />
        </Grid>
        <SectionTitle icon="currency-rupee" right={can("RATES") && a.chargeable ? <Btn compact variant="ghost" label="Add rate" onPress={() => setRateOpen(true)} /> : undefined}>Default surcharge history</SectionTitle>
        <Card>
          {a.rates.length === 0 ? <Text style={[type.bodyMd, { color: color.muted }]}>No default surcharge. Customer-agreed rates can still apply.</Text> : a.rates.map((r) => <Row key={r.effectiveFrom} label={`From ${dateLabel(r.effectiveFrom)}`} value={`${rupees(r.hourlyCharge)}/h`} />)}
        </Card>
        <SectionTitle icon="history">Billed usage</SectionTitle>
        {a.usage.length === 0 ? <Text style={[type.bodyMd, { color: color.muted }]}>No approved breaker hours yet.</Text> : a.usage.map((u) => <ListRow key={u.workOrderId} title={`${u.code} · ${hours(u.hours)}`} subtitle={`${dateLabel(u.workDate)} · ${u.vehicle} · ${u.customerName}`} href={`/work/${u.workOrderId}`} />)}
      </Screen>
      <ConfirmDialog
        visible={rateOpen}
        title="Add default surcharge"
        body="Applies to approved breaker hours on or after this date, unless the customer has an agreed rate."
        confirmLabel="Add"
        onCancel={() => setRateOpen(false)}
        onConfirm={async () => {
          if (!isMoney(rate) || !isValidDate(from)) throw new Error("Enter a valid amount and date.");
          await api.post(`/attachments/${a.id}/rates`, { hourlyCharge: rate, effectiveFrom: from });
          setRateOpen(false);
          flash.ok("Surcharge added");
          await q.refresh();
        }}
      >
        <MoneyInput label="Surcharge per hour" required value={rate} onChange={setRate} />
        <DateInput label="Effective from" value={from} onChange={setFrom} quick={false} />
      </ConfirmDialog>
    </>
  );
}
