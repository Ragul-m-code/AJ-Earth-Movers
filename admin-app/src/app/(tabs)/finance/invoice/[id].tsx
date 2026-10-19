import * as Print from "expo-print";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ConfirmDialog, DateInput, Grid, InfoGrid, isMoney, isValidDate, MoneyInput, Segmented, Select, StatusBadge, useFlash } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, ErrorView, Field, Icon, LoadingView, Row, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, rupees, todayIst } from "@/lib/format";
import { invoiceHtml, type InvoiceView } from "@/lib/invoiceHtml";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

interface TaxRule { id: string; name: string; sacCode: string | null; cgstRate: string | null; sgstRate: string | null; igstRate: string | null; active: boolean; verificationStatus: string }

/** Step 2 / detail: review lines, add charges or discounts, choose tax, issue (Stitch: admin_single_work_order_invoice_builder). */
export default function InvoiceBuilder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const flash = useFlash();
  const q = useLoad(() => Promise.all([api.get<InvoiceView>(`/invoices/${id}`), api.get<TaxRule[]>("/settings/tax-rules").catch(() => [] as TaxRule[])]), [id]);
  const [lineOpen, setLineOpen] = useState<"OTHER" | "DISCOUNT" | null>(null);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [taxOpen, setTaxOpen] = useState(false);
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [split, setSplit] = useState<"INTRA_STATE" | "INTER_STATE">("INTRA_STATE");
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueDate, setIssueDate] = useState(todayIst());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [removeWork, setRemoveWork] = useState<string | null>(null);

  const header = <AppHeader back title={q.data?.[0].number ?? "Invoice draft"} eyebrow={q.data ? (q.data[0].kind === "PROFORMA" ? "Proforma invoice" : "Tax invoice") : "Invoice"} />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const [inv, rules] = q.data;
  const draft = inv.storedStatus === "DRAFT";
  const t = inv.totals;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    await fn();
    flash.ok(ok);
    await q.refresh();
  };
  const print = async () => {
    const html = invoiceHtml(inv);
    if (Platform.OS === "web") {
      const w = window.open("", "_blank");
      if (!w) return flash.fail(null, "Allow pop-ups to print the invoice.");
      w.opener = null;
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    } else {
      await Print.printAsync({ html });
    }
  };

  return (
    <>
      {header}
      <Screen
        onRefresh={q.refresh}
        refreshing={q.refreshing}
        footer={
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}><Btn variant="outline" icon="picture-as-pdf" label={draft ? "Preview" : "PDF"} onPress={print} /></View>
            {draft ? (
              <View style={{ flex: 2 }}><Btn variant="accent" icon="send" label="Issue invoice" onPress={() => setIssueOpen(true)} disabled={inv.issueBlockers.length > 0} /></View>
            ) : (inv.status === "ISSUED" || inv.status === "PARTIALLY_PAID" || inv.status === "OVERDUE") && can("PAYMENTS") ? (
              <View style={{ flex: 2 }}><Btn variant="accent" icon="payments" label="Record payment" onPress={() => router.push({ pathname: "/finance/payment/new", params: { customerId: inv.customer.id, invoiceId: inv.id } })} /></View>
            ) : null}
          </View>
        }
      >
        {flash.node}
        <Card accent={draft ? color.borderStrong : color.accent}>
          <View style={{ paddingLeft: 6, gap: space.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
              <Text style={[type.headlineLg, { color: color.ink, flex: 1 }]}>{inv.customer.name}</Text>
              <StatusBadge status={inv.status} />
            </View>
            <InfoGrid items={[["Invoice no.", inv.number ?? "Assigned when issued"], ["Period", `${dateLabel(inv.periodStart)} – ${dateLabel(inv.periodEnd)}`], ["Issue date", inv.issueDate && dateLabel(inv.issueDate)], ["Due date", inv.dueDate && dateLabel(inv.dueDate)], ["Customer GSTIN", inv.customer.gstin], ["Approved hours", `${t.hours} h`]]} />
          </View>
        </Card>
        {inv.storedStatus === "CANCELLED" && <Banner tone="neutral" title="Cancelled" body={inv.cancelReason ?? undefined} />}
        {draft && inv.issueBlockers.length > 0 && <Banner tone="warning" title="Cannot be issued yet" body={inv.issueBlockers.join(" ")} action={inv.kind === "TAX_INVOICE" && can("SETTINGS") ? <Btn compact variant="outline" label="Open tax settings" onPress={() => router.push("/more/settings/tax")} /> : undefined} />}
        {!draft && inv.kind === "TAX_INVOICE" && !inv.taxVerified && <Banner tone="danger" title="Tax verification has since changed" body="Review the business profile and tax rule in Settings." />}

        <Grid max={2}>
          <View style={{ gap: space.md }}>
            <SectionTitle icon="list-alt" right={draft ? <View style={{ flexDirection: "row", gap: 4 }}><Btn compact variant="ghost" label="+ Charge" onPress={() => setLineOpen("OTHER")} /><Btn compact variant="ghost" label="+ Discount" onPress={() => setLineOpen("DISCOUNT")} /></View> : undefined}>
              Line items
            </SectionTitle>
            {inv.lines.map((l, i) => (
              <Card key={l.id}>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Text style={[type.labelMd, { color: color.muted }]}>{String(i + 1).padStart(2, "0")}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[type.labelLg, { color: color.ink }]}>{l.kind === "MACHINE" ? "Machine hire" : l.kind === "BREAKER" ? "Breaker surcharge" : l.kind === "DISCOUNT" ? "Discount" : "Other charge"}</Text>
                    <Text style={[type.bodySm, { color: color.muted }]}>{l.description}</Text>
                    {l.quantity && <Text style={[type.bodySm, { color: color.navy }]}>{l.quantity} h × {rupees(l.unitRate!, { paise: true })}/h</Text>}
                  </View>
                  <Text style={[type.labelLg, { color: l.kind === "DISCOUNT" ? color.successText : color.ink }]}>{l.kind === "DISCOUNT" ? "−" : ""}{rupees(l.amount, { paise: true })}</Text>
                  {draft && (l.kind === "MACHINE" || l.kind === "OTHER" || l.kind === "DISCOUNT") && (
                    <Pressable accessibilityLabel="Remove line" hitSlop={10} onPress={() => (l.kind === "MACHINE" ? setRemoveWork(l.approvedWorkId) : run(() => api.del(`/invoices/${inv.id}/lines/${l.id}`), "Line removed").catch((e) => flash.fail(e)))}>
                      <Icon name="delete-outline" tint={color.muted} />
                    </Pressable>
                  )}
                </View>
              </Card>
            ))}
          </View>
          <View style={{ gap: space.md }}>
            {inv.kind === "TAX_INVOICE" && (
              <>
                <SectionTitle icon="account-balance" right={draft ? <Btn compact variant="ghost" label="Choose" onPress={() => { setRuleId(inv.taxRule?.id ?? null); setTaxOpen(true); }} /> : undefined}>Tax treatment</SectionTitle>
                <Card>
                  {inv.taxRule ? (
                    <>
                      <Row label="Rule" value={inv.taxRule.name} strong />
                      <Row label="Verification" value={inv.taxRule.verified ? "Verified" : "NOT verified"} />
                      <Row label="Split" value={inv.taxSplit === "INTRA_STATE" ? "CGST + SGST (intra-state)" : inv.taxSplit === "INTER_STATE" ? "IGST (inter-state)" : "No tax"} />
                    </>
                  ) : (
                    <Text style={[type.bodyMd, { color: color.muted }]}>No tax rule chosen. Tax rules are entered and verified by your accountant in Settings; none are assumed.</Text>
                  )}
                </Card>
              </>
            )}
            <SectionTitle icon="calculate">Totals</SectionTitle>
            <Card>
              <Row label="Subtotal" value={rupees(t.subtotal, { paise: true })} />
              {Number(t.discountTotal) > 0 && <Row label="Discounts" value={`−${rupees(t.discountTotal, { paise: true })}`} />}
              <Row label="Taxable value" value={rupees(t.taxableValue, { paise: true })} strong />
              {inv.taxSplit === "INTRA_STATE" && <Row label={`CGST @ ${inv.rates.cgst}%`} value={rupees(t.cgst, { paise: true })} />}
              {inv.taxSplit === "INTRA_STATE" && <Row label={`SGST @ ${inv.rates.sgst}%`} value={rupees(t.sgst, { paise: true })} />}
              {inv.taxSplit === "INTER_STATE" && <Row label={`IGST @ ${inv.rates.igst}%`} value={rupees(t.igst, { paise: true })} />}
              <View style={{ height: 1, backgroundColor: color.border }} />
              <Row label="Invoice total" value={rupees(t.total, { paise: true })} strong />
              {!draft && <Row label="Paid" value={rupees(t.amountPaid, { paise: true })} />}
              {!draft && <Row label="Balance due" value={rupees(t.balance, { paise: true })} strong />}
            </Card>
            {inv.payments.length > 0 && (
              <>
                <SectionTitle icon="payments">Payments</SectionTitle>
                {inv.payments.map((p) => (
                  <Card key={p.paymentId}><Row label={`${dateLabel(p.receivedOn)} · ${p.mode}${p.reference ? ` · ${p.reference}` : ""}`} value={rupees(p.amount, { paise: true })} /></Card>
                ))}
              </>
            )}
            {(draft || inv.storedStatus === "ISSUED") && Number(t.amountPaid) === 0 && can("INVOICES") && (
              <Btn variant="ghost" icon="block" label={draft ? "Discard draft (cancel)" : "Cancel invoice"} onPress={() => setCancelOpen(true)} />
            )}
          </View>
        </Grid>
      </Screen>

      <ConfirmDialog
        visible={!!lineOpen}
        title={lineOpen === "DISCOUNT" ? "Add discount" : "Add charge"}
        body={lineOpen === "DISCOUNT" ? "Reduces the taxable value." : "e.g. mobilisation or transport, agreed with the customer."}
        confirmLabel="Add"
        onCancel={() => setLineOpen(null)}
        onConfirm={async () => {
          if (!isMoney(amount) || desc.trim().length < 3) throw new Error("Enter a description and a valid amount.");
          await api.post(`/invoices/${inv.id}/lines`, { kind: lineOpen, description: desc.trim(), amount });
          setLineOpen(null);
          setDesc("");
          setAmount("");
          flash.ok("Line added");
          await q.refresh();
        }}
      >
        <Field label="Description" required value={desc} onChangeText={setDesc} />
        <MoneyInput label="Amount" required value={amount} onChange={setAmount} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={taxOpen}
        title="Tax treatment"
        body="Only verified rules can be used to issue. Rates are copied onto this invoice when you save."
        confirmLabel="Save"
        onCancel={() => setTaxOpen(false)}
        onConfirm={async () => {
          await api.post(`/invoices/${inv.id}/tax`, { taxRuleId: ruleId, split: ruleId ? split : "NONE" });
          setTaxOpen(false);
          flash.ok("Tax updated");
          await q.refresh();
        }}
      >
        <Select label="Tax rule" value={ruleId ?? "__none"} onChange={(v) => setRuleId(v === "__none" ? null : v)} options={[{ value: "__none", label: "No tax" }, ...rules.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name, hint: `${r.verificationStatus === "VERIFIED" ? "Verified" : "NOT verified"} · CGST ${r.cgstRate ?? "–"} / SGST ${r.sgstRate ?? "–"} / IGST ${r.igstRate ?? "–"}` }))]} />
        {ruleId && <Segmented value={split} onChange={setSplit} options={[{ value: "INTRA_STATE", label: "CGST + SGST" }, { value: "INTER_STATE", label: "IGST" }]} />}
      </ConfirmDialog>
      <ConfirmDialog
        visible={issueOpen}
        title="Issue this invoice?"
        body={`A number is assigned and the invoice can no longer be edited. Total ${rupees(t.total, { paise: true })}.`}
        confirmLabel="Issue"
        onCancel={() => setIssueOpen(false)}
        onConfirm={async () => {
          if (!isValidDate(issueDate)) throw new Error("Enter the issue date.");
          await api.post(`/invoices/${inv.id}/issue`, { issueDate });
          setIssueOpen(false);
          flash.ok("Invoice issued");
          await q.refresh();
        }}
      >
        <DateInput label="Invoice date" value={issueDate} onChange={setIssueDate} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={cancelOpen}
        title={draft ? "Discard this draft?" : "Cancel this invoice?"}
        body="The work records are released so they can be billed correctly. The cancelled invoice is kept for audit."
        confirmLabel={draft ? "Discard" : "Cancel invoice"}
        danger
        reasonLabel="Reason"
        onCancel={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          await api.post(`/invoices/${inv.id}/cancel`, { reason });
          setCancelOpen(false);
          flash.ok("Invoice cancelled");
          await q.refresh();
        }}
      />
      <ConfirmDialog
        visible={!!removeWork}
        title="Remove this work from the draft?"
        body="Its machine and breaker lines are removed and the work becomes available to invoice again."
        confirmLabel="Remove"
        onCancel={() => setRemoveWork(null)}
        onConfirm={async () => {
          await api.del(`/invoices/${inv.id}/work/${removeWork}`);
          setRemoveWork(null);
          flash.ok("Work removed");
          await q.refresh();
        }}
      />
    </>
  );
}
