import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { ConfirmDialog, DateInput, Grid, InfoGrid, isMoney, isValidDate, Kpi, ListRow, MoneyInput, Segmented, Select, StatusBadge, useFlash } from "@/components/kit";
import { AppHeader, Btn, Card, ErrorView, Field, LoadingView, Row, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, hours, rupees, shortDate, todayIst } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Lookups } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

interface CustomerProfile {
  id: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null; gstin: string | null; stateCode: string | null; billingCycle: string; paymentTermsDays: number; notes: string | null; active: boolean;
  sites: { id: string; name: string; address: string | null; contactName: string | null; contactPhone: string | null; active: boolean }[];
  rates: { id: string; scope: "VEHICLE" | "CATEGORY"; vehicle: { id: string; unitCode: string; model: string } | null; category: string | null; hourlyRate: string; effectiveFrom: string }[];
  attachmentRates: { id: string; attachment: { id: string; code: string; name: string }; hourlyCharge: string; effectiveFrom: string }[];
  financials: { outstanding: string; unallocatedCredit: string; invoices: { id: string; number: string | null; kind: string; status: string; periodStart: string; periodEnd: string; total: string; amountPaid: string; dueDate: string | null }[]; payments: { id: string; receivedOn: string; amount: string; mode: string; reference: string | null }[] } | null;
  unbilled: { jobs: number; hours: string };
  recentJobs: { id: string; code: string; status: string; workDate: string; siteName: string; vehicle: string; driverName: string }[];
}
const CYCLE: Record<string, string> = { PER_WORK_ORDER: "Per work order", DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", CUSTOM: "Custom period" };

/** Customer profile: contacts, sites, agreed rates, invoices and payments (Stitch: admin_customer_profile, admin_customer_invoices_ledger). */
export default function CustomerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const flash = useFlash();
  const q = useLoad(() => api.get<CustomerProfile>(`/customers/${id}`), [id]);
  const lk = useLoad(() => api.get<Lookups>("/lookups"));
  const [siteOpen, setSiteOpen] = useState(false);
  const [site, setSite] = useState({ name: "", address: "", contactName: "", contactPhone: "" });
  const [rateOpen, setRateOpen] = useState(false);
  const [scope, setScope] = useState<"CATEGORY" | "VEHICLE" | "ATTACHMENT">("CATEGORY");
  const [target, setTarget] = useState<string | null>(null);
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState(todayIst());

  const header = <AppHeader back title={q.data?.name ?? "Customer"} eyebrow="Customer profile" />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const c = q.data;

  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        {flash.node}
        <Card accent={color.accent}>
          <View style={{ paddingLeft: 6, gap: space.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={[type.headlineLg, { color: color.ink, flex: 1 }]}>{c.name}</Text>
              <StatusBadge status={c.active ? "ACTIVE" : "INACTIVE"} />
            </View>
            <InfoGrid items={[["Contact", c.contactName], ["Phone", c.phone], ["Email", c.email], ["GSTIN", c.gstin], ["Billing cycle", CYCLE[c.billingCycle]], ["Payment terms", `${c.paymentTermsDays} days`], ["Address", c.address], ["Notes", c.notes]]} />
            <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
              <Btn compact variant="outline" icon="edit" label="Edit" onPress={() => router.push({ pathname: "/more/customers/edit", params: { id: c.id } })} />
              {c.phone && <Btn compact variant="outline" icon="call" label="Call" onPress={() => Linking.openURL(`tel:${c.phone!.replace(/\s/g, "")}`)} />}
              {can("INVOICES") && <Btn compact variant="accent" icon="request-quote" label="Create invoice" onPress={() => router.push({ pathname: "/finance/invoice/new", params: { customerId: c.id } })} />}
            </View>
          </View>
        </Card>
        <Grid max={3}>
          {c.financials && <Kpi label="Outstanding" value={rupees(c.financials.outstanding)} tone={Number(c.financials.outstanding) > 0 ? "warning" : undefined} />}
          {c.financials && Number(c.financials.unallocatedCredit) > 0 && <Kpi label="Unallocated credit" value={rupees(c.financials.unallocatedCredit)} />}
          <Kpi label="Approved, not invoiced" value={hours(c.unbilled.hours)} sub={`${c.unbilled.jobs} work record(s)`} />
        </Grid>

        <Grid max={2}>
          <View style={{ gap: space.md }}>
            <SectionTitle icon="place" right={<Btn compact variant="ghost" label="Add site" onPress={() => setSiteOpen(true)} />}>Sites ({c.sites.length})</SectionTitle>
            {c.sites.length === 0 ? <Text style={[type.bodyMd, { color: color.muted }]}>No saved sites.</Text> : c.sites.map((s) => <ListRow key={s.id} icon="place" title={s.name} subtitle={[s.address, s.contactName, s.contactPhone].filter(Boolean).join(" · ") || undefined} />)}
            <SectionTitle icon="currency-rupee" right={can("RATES") ? <Btn compact variant="ghost" label="Add rate" onPress={() => setRateOpen(true)} /> : undefined}>Agreed rates</SectionTitle>
            <Card>
              {c.rates.length === 0 && c.attachmentRates.length === 0 && <Text style={[type.bodyMd, { color: color.muted }]}>No agreed rates. Machine default rates apply.</Text>}
              {c.rates.map((r) => <Row key={r.id} label={`${r.scope === "VEHICLE" ? `${r.vehicle?.unitCode} (${r.vehicle?.model})` : `All ${r.category}`} · from ${dateLabel(r.effectiveFrom)}`} value={`${rupees(r.hourlyRate)}/h`} />)}
              {c.attachmentRates.map((r) => <Row key={r.id} label={`${r.attachment.name} surcharge · from ${dateLabel(r.effectiveFrom)}`} value={`+${rupees(r.hourlyCharge)}/h`} />)}
              <Text style={[type.bodySm, { color: color.muted }]}>Most specific rate wins: machine, then category, then the machine default. Changes never alter issued invoices.</Text>
            </Card>
          </View>
          <View style={{ gap: space.md }}>
            {c.financials && (
              <>
                <SectionTitle icon="receipt-long">Invoices</SectionTitle>
                {c.financials.invoices.length === 0 ? <Text style={[type.bodyMd, { color: color.muted }]}>No invoices yet.</Text> : c.financials.invoices.map((i) => (
                  <ListRow key={i.id} title={`${i.number ?? "Draft"} · ${rupees(i.total, { paise: true })}`} subtitle={`${shortDate(i.periodStart)} – ${dateLabel(i.periodEnd)}${Number(i.amountPaid) > 0 ? ` · paid ${rupees(i.amountPaid)}` : ""}`} right={<StatusBadge status={i.status} />} href={`/finance/invoice/${i.id}`} />
                ))}
                <SectionTitle icon="payments">Payments</SectionTitle>
                {c.financials.payments.length === 0 ? <Text style={[type.bodyMd, { color: color.muted }]}>No payments yet.</Text> : c.financials.payments.map((p) => <Row key={p.id} label={`${dateLabel(p.receivedOn)} · ${p.mode}${p.reference ? ` · ${p.reference}` : ""}`} value={rupees(p.amount, { paise: true })} />)}
              </>
            )}
            <SectionTitle icon="assignment">Recent jobs</SectionTitle>
            {c.recentJobs.map((w) => <ListRow key={w.id} title={`${w.code} · ${dateLabel(w.workDate)}`} subtitle={`${w.siteName} · ${w.vehicle} · ${w.driverName}`} right={<StatusBadge status={w.status} />} href={`/work/${w.id}`} />)}
          </View>
        </Grid>
      </Screen>

      <ConfirmDialog
        visible={siteOpen}
        title="Add site"
        confirmLabel="Add site"
        onCancel={() => setSiteOpen(false)}
        onConfirm={async () => {
          if (site.name.trim().length < 2) throw new Error("Enter the site name.");
          await api.post(`/customers/${c.id}/sites`, { name: site.name, address: site.address || null, contactName: site.contactName || null, contactPhone: site.contactPhone || null });
          setSiteOpen(false);
          setSite({ name: "", address: "", contactName: "", contactPhone: "" });
          flash.ok("Site added");
          await q.refresh();
        }}
      >
        <Field label="Site name" required value={site.name} onChangeText={(v) => setSite((s) => ({ ...s, name: v }))} />
        <Field label="Address" value={site.address} onChangeText={(v) => setSite((s) => ({ ...s, address: v }))} multiline />
        <Field label="Site contact" value={site.contactName} onChangeText={(v) => setSite((s) => ({ ...s, contactName: v }))} />
        <Field label="Contact phone" value={site.contactPhone} onChangeText={(v) => setSite((s) => ({ ...s, contactPhone: v }))} keyboardType="phone-pad" />
      </ConfirmDialog>
      <ConfirmDialog
        visible={rateOpen}
        title="Add agreed rate"
        body="Applies to work on or after the effective date. Earlier work and issued invoices are not changed."
        confirmLabel="Add rate"
        onCancel={() => setRateOpen(false)}
        onConfirm={async () => {
          if (!target || !isMoney(rate) || !isValidDate(from)) throw new Error("Choose what the rate applies to, and enter a valid rate and date.");
          if (scope === "ATTACHMENT") await api.post(`/customers/${c.id}/attachment-rates`, { attachmentId: target, hourlyCharge: rate, effectiveFrom: from });
          else await api.post(`/customers/${c.id}/rates`, { ...(scope === "VEHICLE" ? { vehicleId: target } : { category: target }), hourlyRate: rate, effectiveFrom: from });
          setRateOpen(false);
          setRate("");
          setTarget(null);
          flash.ok("Rate added");
          await q.refresh();
        }}
      >
        <Segmented value={scope} onChange={(v) => { setScope(v); setTarget(null); }} options={[{ value: "CATEGORY", label: "Machine type" }, { value: "VEHICLE", label: "One machine" }, { value: "ATTACHMENT", label: "Breaker / attachment" }]} />
        {lk.data && (
          <Select
            label={scope === "CATEGORY" ? "Machine category" : scope === "VEHICLE" ? "Machine" : "Attachment"}
            value={target}
            onChange={setTarget}
            options={scope === "CATEGORY" ? lk.data.categories.map((x) => ({ value: x, label: x })) : scope === "VEHICLE" ? lk.data.vehicles.map((v) => ({ value: v.id, label: `${v.unitCode} · ${v.make} ${v.model}` })) : lk.data.attachments.filter((a) => a.chargeable).map((a) => ({ value: a.id, label: a.name, hint: a.code }))}
          />
        )}
        <MoneyInput label={scope === "ATTACHMENT" ? "Surcharge per hour" : "Hourly rate"} required value={rate} onChange={setRate} />
        <DateInput label="Effective from" value={from} onChange={setFrom} quick={false} />
      </ConfirmDialog>
    </>
  );
}
