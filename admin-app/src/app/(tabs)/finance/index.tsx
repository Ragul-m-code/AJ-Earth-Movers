import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { ConfirmDialog, DateInput, Grid, isValidDate, Kpi, ListRow, Pager, SearchBar, Segmented, Select, StatusBadge, useDebounced, useFlash } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, Chips, EmptyView, ErrorView, Field, LoadingView, Row, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, hours, rupees, shortDate, todayIst } from "@/lib/format";
import { useSession, type Module } from "@/lib/session";
import type { Paged } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

type Tab = "invoices" | "payments" | "payroll" | "expenses";
const TABS: { value: Tab; label: string; module: Module }[] = [
  { value: "invoices", label: "Invoices", module: "INVOICES" },
  { value: "payments", label: "Payments", module: "PAYMENTS" },
  { value: "payroll", label: "Payroll", module: "PAYROLL" },
  { value: "expenses", label: "Expenses", module: "EXPENSES" },
];

export default function FinanceHub() {
  const params = useLocalSearchParams<{ view?: Tab; status?: string }>();
  const { can } = useSession();
  const tabs = TABS.filter((t) => can(t.module));
  const [chosen, setChosen] = useState<{ v: Tab; from?: string }>({ v: params.view ?? tabs[0]?.value ?? "invoices", from: params.view });
  const tab = params.view && params.view !== chosen.from ? params.view : chosen.v;
  return (
    <>
      <AppHeader title="Finance" eyebrow="Billing, collections, payroll & expenses" />
      <Screen>
        {tabs.length === 0 ? (
          <EmptyView icon="lock" title="No finance access" body="Your account does not include financial modules. Ask the owner if you need access." />
        ) : (
          <>
            <Segmented value={tab} onChange={(v) => setChosen({ v, from: params.view })} options={tabs} />
            {tab === "invoices" ? <Invoices initialStatus={params.status} /> : tab === "payments" ? <Payments /> : tab === "payroll" ? <Payroll /> : <Expenses />}
          </>
        )}
      </Screen>
    </>
  );
}

interface InvoiceRow { id: string; number: string | null; kind: string; status: string; customer: { id: string; name: string }; periodStart: string; periodEnd: string; issueDate: string | null; dueDate: string | null; total: string; amountPaid: string; balance: string }

function Invoices({ initialStatus }: { initialStatus?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus ?? "all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const s = useDebounced(search);
  const q = useLoad(
    () => api.get<Paged<InvoiceRow> & { summary: { outstanding: string; overdueAmount: string; overdueCount: number } }>("/invoices", { status: status === "all" ? undefined : [status], search: s, page, pageSize: 20 }),
    [status, s, page],
  );
  return (
    <>
      {q.data && (
        <Grid max={3}>
          <Kpi label="Outstanding" value={rupees(q.data.summary.outstanding)} sub="Issued invoices not yet paid" icon="account-balance-wallet" />
          <Kpi label="Overdue" value={rupees(q.data.summary.overdueAmount)} sub={`${q.data.summary.overdueCount} invoice(s) past due`} tone={q.data.summary.overdueCount ? "danger" : undefined} icon="warning-amber" onPress={() => setStatus("OVERDUE")} />
          <Btn variant="accent" icon="add" label="Create invoice" onPress={() => router.push("/finance/invoice/new")} />
        </Grid>
      )}
      <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search invoice number or customer" />
      <Chips
        value={status}
        onChange={(v) => { setStatus(v); setPage(1); }}
        options={[{ value: "all", label: "All" }, { value: "DRAFT", label: "Drafts" }, { value: "ISSUED", label: "Issued" }, { value: "PARTIALLY_PAID", label: "Part paid" }, { value: "OVERDUE", label: "Overdue" }, { value: "PAID", label: "Paid" }, { value: "CANCELLED", label: "Cancelled" }]}
      />
      {q.loading ? (
        <LoadingView />
      ) : !q.data ? (
        <ErrorView error={q.error!} onRetry={q.reload} />
      ) : q.data.items.length === 0 ? (
        <EmptyView icon="receipt-long" title="No invoices" body="Create an invoice from approved work records." />
      ) : (
        <>
          <Grid max={2}>
            {q.data.items.map((i) => (
              <ListRow
                key={i.id}
                accent={i.status === "OVERDUE" ? color.danger : i.status === "PAID" ? color.success : i.status === "DRAFT" ? color.borderStrong : color.info}
                title={`${i.number ?? "Draft"} · ${i.customer.name}`}
                subtitle={`${i.kind === "PROFORMA" ? "Proforma · " : ""}${shortDate(i.periodStart)} – ${dateLabel(i.periodEnd)}${i.dueDate ? ` · due ${dateLabel(i.dueDate)}` : ""}`}
                meta={`${rupees(i.total, { paise: true })}${Number(i.balance) > 0 && i.status !== "DRAFT" ? ` · balance ${rupees(i.balance, { paise: true })}` : ""}`}
                right={<StatusBadge status={i.status} />}
                href={`/finance/invoice/${i.id}`}
              />
            ))}
          </Grid>
          <Pager page={page} pageSize={20} total={q.data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

interface PaymentRow { id: string; customer: { id: string; name: string }; receivedOn: string; amount: string; mode: string; reference: string | null; unallocated: string }

function Payments() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const q = useLoad(() => api.get<Paged<PaymentRow> & { totalReceived: string }>("/payments", { page, pageSize: 25 }), [page]);
  if (q.loading) return <LoadingView />;
  if (!q.data) return <ErrorView error={q.error!} onRetry={q.reload} />;
  return (
    <>
      <Grid max={2}>
        <Kpi label="Payments recorded" value={rupees(q.data.totalReceived)} sub={`${q.data.total} payment(s)`} icon="payments" />
        <Btn variant="accent" icon="add" label="Record payment" onPress={() => router.push("/finance/payment/new")} />
      </Grid>
      {q.data.items.length === 0 ? (
        <EmptyView icon="payments" title="No payments yet" />
      ) : (
        q.data.items.map((p) => (
          <ListRow
            key={p.id}
            icon="payments"
            title={`${rupees(p.amount, { paise: true })} · ${p.customer.name}`}
            subtitle={`${dateLabel(p.receivedOn)} · ${p.mode}${p.reference ? ` · ${p.reference}` : ""}`}
            meta={Number(p.unallocated) > 0 ? `${rupees(p.unallocated, { paise: true })} unallocated credit` : undefined}
          />
        ))
      )}
      <Pager page={page} pageSize={25} total={q.data.total} onPage={setPage} />
    </>
  );
}

interface PayrollData {
  runs: { id: string; driver: { id: string; driverCode: string; fullName: string }; periodStart: string; periodEnd: string; method: string; status: string; approvedHours: string; workingDays: number; grossAmount: string; additionsTotal: string; deductionsTotal: string; netAmount: string; paidAt: string | null; paymentMode: string | null; paymentRef: string | null }[];
  openAdjustments: { id: string; driver: { id: string; fullName: string }; kind: string; amount: string; description: string; effectiveOn: string; status: string }[];
}

function Payroll() {
  const router = useRouter();
  const flash = useFlash();
  const q = useLoad(() => api.get<PayrollData>("/payroll"));
  const [action, setAction] = useState<{ kind: "approve" | "paid" | "discard"; run: PayrollData["runs"][number] } | null>(null);
  const [adj, setAdj] = useState<{ id: string; decision: "APPROVED" | "VOID" } | null>(null);
  const [paidOn, setPaidOn] = useState(todayIst());
  const [mode, setMode] = useState("NEFT");
  const [ref, setRef] = useState("");
  if (q.loading) return <LoadingView />;
  if (!q.data) return <ErrorView error={q.error!} onRetry={q.reload} />;
  return (
    <>
      {flash.node}
      <Btn variant="accent" icon="add" label="Prepare payroll" onPress={() => router.push("/finance/payroll/new")} />
      {q.data.openAdjustments.length > 0 && (
        <>
          <Text style={[type.headlineSm, { color: color.ink }]}>Salary adjustments not yet in payroll</Text>
          {q.data.openAdjustments.map((a) => (
            <Card key={a.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                <Text style={[type.labelLg, { color: color.ink, flex: 1 }]}>{a.driver.fullName}: {a.kind === "ADDITION" ? "+" : "−"}{rupees(a.amount, { paise: true })}</Text>
                <StatusBadge status={a.status} />
              </View>
              <Text style={[type.bodySm, { color: color.muted }]}>{a.description} · {dateLabel(a.effectiveOn)}</Text>
              {a.status === "PENDING" && (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Btn compact variant="dark" label="Approve" onPress={() => setAdj({ id: a.id, decision: "APPROVED" })} />
                  <Btn compact variant="ghost" label="Void" onPress={() => setAdj({ id: a.id, decision: "VOID" })} />
                </View>
              )}
            </Card>
          ))}
        </>
      )}
      <Text style={[type.headlineSm, { color: color.ink }]}>Payroll runs</Text>
      {q.data.runs.length === 0 ? (
        <EmptyView icon="badge" title="No payroll runs" body="Prepare payroll for a driver and period from approved work." />
      ) : (
        <Grid max={2}>
          {q.data.runs.map((r) => (
            <Card key={r.id} accent={r.status === "PAID" ? color.success : r.status === "APPROVED" ? color.info : color.borderStrong}>
              <View style={{ paddingLeft: 6, gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                  <Text style={[type.labelLg, { color: color.ink, flex: 1 }]}>{r.driver.fullName} ({r.driver.driverCode})</Text>
                  <StatusBadge status={r.status} />
                </View>
                <Text style={[type.bodySm, { color: color.muted }]}>{shortDate(r.periodStart)} – {dateLabel(r.periodEnd)} · {r.method === "FIXED" ? "Fixed salary" : "Hourly"} · {hours(r.approvedHours)} · {r.workingDays} day(s)</Text>
                <Row label="Gross" value={rupees(r.grossAmount, { paise: true })} />
                {Number(r.additionsTotal) > 0 && <Row label="+ Additions" value={rupees(r.additionsTotal, { paise: true })} />}
                {Number(r.deductionsTotal) > 0 && <Row label="− Deductions" value={rupees(r.deductionsTotal, { paise: true })} />}
                <Row label="Net payable" value={rupees(r.netAmount, { paise: true })} strong />
                {r.status === "PAID" && <Text style={[type.bodySm, { color: color.successText }]}>Paid {r.paidAt ? dateLabel(r.paidAt) : ""} · {r.paymentMode}{r.paymentRef ? ` · ${r.paymentRef}` : ""}</Text>}
                <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                  {r.status === "DRAFT" && <Btn compact variant="dark" label="Approve" onPress={() => setAction({ kind: "approve", run: r })} />}
                  {r.status === "DRAFT" && <Btn compact variant="ghost" label="Discard draft" onPress={() => setAction({ kind: "discard", run: r })} />}
                  {r.status === "APPROVED" && <Btn compact variant="accent" label="Record salary payment" onPress={() => setAction({ kind: "paid", run: r })} />}
                </View>
              </View>
            </Card>
          ))}
        </Grid>
      )}
      <ConfirmDialog
        visible={!!action}
        title={action?.kind === "approve" ? "Approve payroll?" : action?.kind === "paid" ? "Record salary payment" : "Discard draft?"}
        body={action ? `${action.run.driver.fullName}: net ${rupees(action.run.netAmount, { paise: true })}.${action.kind === "discard" ? " The work records return to unpaid." : ""}` : undefined}
        confirmLabel={action?.kind === "approve" ? "Approve" : action?.kind === "paid" ? "Mark paid" : "Discard"}
        danger={action?.kind === "discard"}
        onCancel={() => setAction(null)}
        onConfirm={async () => {
          const r = action!.run;
          if (action!.kind === "approve") await api.post(`/payroll/${r.id}/approve`);
          else if (action!.kind === "discard") await api.del(`/payroll/${r.id}`);
          else {
            if (!isValidDate(paidOn)) throw new Error("Enter the payment date.");
            await api.post(`/payroll/${r.id}/paid`, { paidOn, mode, reference: ref || undefined });
          }
          setAction(null);
          flash.ok("Payroll updated");
          await q.refresh();
        }}
      >
        {action?.kind === "paid" && (
          <>
            <DateInput label="Paid on" value={paidOn} onChange={setPaidOn} />
            <Select label="Mode" value={mode} onChange={setMode} options={["NEFT", "RTGS", "IMPS", "UPI", "CHEQUE", "CASH", "OTHER"].map((m) => ({ value: m, label: m }))} />
            <Field label="Reference / UTR (optional)" value={ref} onChangeText={setRef} autoCapitalize="characters" />
          </>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        visible={!!adj}
        title={adj?.decision === "APPROVED" ? "Approve adjustment?" : "Void adjustment?"}
        body="Another authorized user must approve an adjustment you created."
        confirmLabel={adj?.decision === "APPROVED" ? "Approve" : "Void"}
        danger={adj?.decision === "VOID"}
        onCancel={() => setAdj(null)}
        onConfirm={async () => {
          await api.post(`/adjustments/${adj!.id}/decision`, { decision: adj!.decision });
          setAdj(null);
          flash.ok("Adjustment updated");
          await q.refresh();
        }}
      />
    </>
  );
}

interface ExpenseData { items: { id: string; category: string; vehicle: { id: string; unitCode: string } | null; spentOn: string; amount: string; description: string; vendor: string | null; reference: string | null }[]; byCategory: { category: string; amount: string }[]; total: string }

function Expenses() {
  const router = useRouter();
  const month = todayIst().slice(0, 7);
  const [from, setFrom] = useState(`${month}-01`);
  const [to, setTo] = useState(todayIst());
  const ok = isValidDate(from) && isValidDate(to);
  const q = useLoad(() => (ok ? api.get<ExpenseData>("/expenses", { from, to }) : Promise.resolve(null)), [from, to]);
  return (
    <>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <View style={{ flex: 1 }}><DateInput label="From" value={from} onChange={setFrom} quick={false} /></View>
        <View style={{ flex: 1 }}><DateInput label="To" value={to} onChange={setTo} quick={false} /></View>
      </View>
      <Btn variant="accent" icon="add" label="Record expense" onPress={() => router.push("/finance/expense/new")} />
      {q.loading ? (
        <LoadingView />
      ) : q.error ? (
        <ErrorView error={q.error} onRetry={q.reload} />
      ) : q.data ? (
        <>
          <Grid max={3}>
            <Kpi label="Total in period" value={rupees(q.data.total)} icon="receipt" />
            {q.data.byCategory.slice(0, 2).map((c) => (
              <Kpi key={c.category} label={c.category} value={rupees(c.amount)} />
            ))}
          </Grid>
          {q.data.items.length === 0 ? (
            <EmptyView icon="receipt" title="No expenses in this period" />
          ) : (
            q.data.items.map((e) => (
              <ListRow key={e.id} icon="receipt" title={`${rupees(e.amount, { paise: true })} · ${e.category}`} subtitle={`${dateLabel(e.spentOn)} · ${e.description}${e.vehicle ? ` · ${e.vehicle.unitCode}` : ""}${e.vendor ? ` · ${e.vendor}` : ""}`} />
            ))
          )}
          <Banner tone="info" title="Expenses are not deducted from invoices" body="They are recorded for cost reporting. Billing uses approved hours and agreed rates only." />
        </>
      ) : null}
    </>
  );
}
