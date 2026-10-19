import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { DateInput, FormSection, isValidDate, Segmented, Select } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, EmptyView, ErrorView, Icon, LoadingView, Screen, SectionTitle } from "@/components/ui";
import { api, ApiError, newKey } from "@/lib/api";
import { dateLabel, hours, rupees, shiftMonth, todayIst } from "@/lib/format";
import type { Lookups } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

interface Billable {
  items: {
    approvedWorkId: string; workOrderId: string; code: string; workDate: string; siteName: string; vehicle: { unitCode: string; make: string; model: string; category: string };
    approvedHours: string; breakerHours: string; breaker: { code: string; name: string } | null; machineRate: string | null; machineRateSource: string | null; breakerRate: string | null;
    machineCharge: string | null; breakerCharge: string | null; missingRates: string[];
  }[];
  total: string;
  alreadyBilled: { code: string; workDate: string; invoiceNumber: string; invoiceId: string | null }[];
  notYetApproved: { workOrderId: string; code: string; status: string; workDate: string; vehicle: string; driverName: string }[];
}

const monthBounds = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return { from: `${m}-01`, to: `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}` };
};
const SOURCE: Record<string, string> = { "customer:vehicle": "agreed (machine)", "customer:category": "agreed (category)", "vehicle-default": "machine default" };

/** Step 1: choose customer, invoice type, period and the approved work to bill (Stitch: admin_create_invoice_select_scope). */
export default function CreateInvoice() {
  const params = useLocalSearchParams<{ customerId?: string }>();
  const router = useRouter();
  const lk = useLoad(() => api.get<Lookups>("/lookups"));
  const thisMonth = todayIst().slice(0, 7);
  const [customerId, setCustomerId] = useState<string | null>(params.customerId ?? null);
  const [kind, setKind] = useState<"TAX_INVOICE" | "PROFORMA">("TAX_INVOICE");
  const [preset, setPreset] = useState<"this" | "last" | "custom">("this");
  const [custom, setCustom] = useState(monthBounds(thisMonth));
  const period = preset === "this" ? monthBounds(thisMonth) : preset === "last" ? monthBounds(shiftMonth(thisMonth, -1)) : custom;
  const periodOk = isValidDate(period.from) && isValidDate(period.to) && period.from <= period.to;
  const work = useLoad(() => (customerId && periodOk ? api.get<Billable>("/invoices/billable", { customerId, from: period.from, to: period.to }) : Promise.resolve(null)), [customerId, period.from, period.to]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per draft attempt, so a double tap or retry returns the same draft instead of a second one.
  const key = useRef(newKey());

  const billable = (work.data?.items ?? []).filter((i) => i.missingRates.length === 0);
  const selected = billable.filter((i) => !excluded.has(i.approvedWorkId));
  const total = useMemo(() => selected.reduce((s, i) => s + Number(i.machineCharge ?? 0) + Number(i.breakerCharge ?? 0), 0), [selected]);
  const totalHours = selected.reduce((s, i) => s + Number(i.approvedHours), 0);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const inv = await api.post<{ id: string }>("/invoices", { customerId, kind, periodStart: period.from, periodEnd: period.to, approvedWorkIds: selected.map((i) => i.approvedWorkId), idempotencyKey: key.current });
      router.replace(`/finance/invoice/${inv.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The draft was not created.");
      if (e instanceof ApiError && e.code === "ALREADY_BILLED") await work.refresh();
      key.current = newKey();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppHeader back title="Create invoice" eyebrow="Step 1 of 2 · scope" />
      <Screen
        footer={
          <Btn variant="accent" icon="arrow-forward" label={selected.length ? `Create draft · ${rupees(total, { paise: true })}` : "Select work to invoice"} sub={selected.length ? `${selected.length} work record(s) · ${totalHours.toFixed(1)} h · before tax` : undefined} onPress={create} loading={busy} disabled={!selected.length} />
        }
      >
        {error && <Banner tone="danger" title="Draft not created" body={error} />}
        <FormSection step="01" title="Customer & invoice type">
          {lk.data ? <Select label="Customer" required searchable value={customerId} onChange={(v) => { setCustomerId(v); setExcluded(new Set()); }} options={lk.data.customers.map((c) => ({ value: c.id, label: c.name }))} /> : <LoadingView />}
          <Segmented value={kind} onChange={setKind} options={[{ value: "TAX_INVOICE", label: "Tax invoice" }, { value: "PROFORMA", label: "Proforma (no tax)" }]} />
          <Text style={[type.bodySm, { color: color.muted }]}>
            {kind === "TAX_INVOICE"
              ? "A tax invoice can be drafted now but issued only after your business profile and the tax rule are verified in Settings."
              : "A proforma is a priced statement without tax. It is not a tax invoice."}
          </Text>
        </FormSection>
        <FormSection step="02" title="Billing period">
          <Segmented value={preset} onChange={setPreset} options={[{ value: "this", label: "This month" }, { value: "last", label: "Last month" }, { value: "custom", label: "Custom" }]} />
          {preset === "custom" ? (
            <View style={{ flexDirection: "row", gap: space.md }}>
              <View style={{ flex: 1 }}><DateInput label="From" value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} quick={false} /></View>
              <View style={{ flex: 1 }}><DateInput label="To" value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} quick={false} /></View>
            </View>
          ) : (
            <Text style={[type.labelLg, { color: color.navy }]}>{dateLabel(period.from)} – {dateLabel(period.to)}</Text>
          )}
          {!periodOk && <Text style={[type.bodySm, { color: color.dangerText }]}>Enter a valid period.</Text>}
        </FormSection>

        {customerId && (
          <>
            <SectionTitle icon="checklist" right={billable.length ? <Pressable onPress={() => setExcluded(excluded.size ? new Set() : new Set(billable.map((b) => b.approvedWorkId)))} hitSlop={10}><Text style={[type.labelLg, { color: color.navy, fontFamily: font.bold }]}>{excluded.size ? "Select all" : "Clear all"}</Text></Pressable> : undefined}>
              Approved work ready to invoice
            </SectionTitle>
            {work.loading ? (
              <LoadingView />
            ) : work.error ? (
              <ErrorView error={work.error} onRetry={work.reload} />
            ) : work.data && work.data.items.length === 0 ? (
              <EmptyView icon="inventory" title="No unbilled approved work in this period" />
            ) : (
              work.data?.items.map((i) => {
                const blocked = i.missingRates.length > 0;
                const on = !blocked && !excluded.has(i.approvedWorkId);
                return (
                  <Pressable
                    key={i.approvedWorkId}
                    disabled={blocked}
                    onPress={() => setExcluded((s) => { const n = new Set(s); if (n.has(i.approvedWorkId)) n.delete(i.approvedWorkId); else n.add(i.approvedWorkId); return n; })}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: blocked }}
                    style={{ flexDirection: "row", gap: space.md, backgroundColor: color.white, borderWidth: 1.5, borderColor: on ? color.accent : color.border, borderRadius: radius.lg, padding: space.md, opacity: blocked ? 0.7 : 1 }}
                  >
                    <View style={{ width: 24, height: 24, borderRadius: 4, borderWidth: 2, borderColor: on ? color.navy : color.muted, backgroundColor: on ? color.navy : color.white, alignItems: "center", justifyContent: "center", marginTop: 2 }}>
                      {on && <Icon name="check" size={16} tint={color.white} />}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[type.labelLg, { color: color.ink }]}>{i.code} · {dateLabel(i.workDate)}</Text>
                      <Text style={[type.bodySm, { color: color.muted }]}>{i.vehicle.make} {i.vehicle.model} ({i.vehicle.unitCode}) · {i.siteName}</Text>
                      {blocked ? (
                        <Text style={[type.bodySm, { color: color.dangerText }]}>Cannot invoice: no {i.missingRates.join(", ")}. Add the rate in the customer profile or machine details.</Text>
                      ) : (
                        <>
                          <Text style={[type.bodySm, { color: color.navy }]}>
                            {hours(i.approvedHours)} × {rupees(i.machineRate!)}/h ({SOURCE[i.machineRateSource!] ?? i.machineRateSource}) = {rupees(i.machineCharge!, { paise: true })}
                          </Text>
                          {Number(i.breakerHours) > 0 && <Text style={[type.bodySm, { color: color.navy }]}>+ {i.breaker?.name}: {hours(i.breakerHours)} × {rupees(i.breakerRate!)}/h = {rupees(i.breakerCharge!, { paise: true })}</Text>}
                        </>
                      )}
                    </View>
                  </Pressable>
                );
              })
            )}
            {work.data && work.data.notYetApproved.length > 0 && (
              <Banner tone="warning" title={`${work.data.notYetApproved.length} job(s) not approved yet`} body={`${work.data.notYetApproved.map((w) => `${w.code} (${w.status.replace(/_/g, " ").toLowerCase()})`).join(", ")}. Unapproved hours are never billed.`} />
            )}
            {work.data && work.data.alreadyBilled.length > 0 && (
              <Card>
                <Text style={[type.labelSm, { color: color.muted }]}>Already on an invoice (cannot be billed again)</Text>
                {work.data.alreadyBilled.map((b) => (
                  <Text key={b.code} style={[type.bodySm, { color: color.navy }]}>{b.code} · {dateLabel(b.workDate)} → {b.invoiceNumber}</Text>
                ))}
              </Card>
            )}
          </>
        )}
      </Screen>
    </>
  );
}
