import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { DateInput, FormSection, isMoney, isValidDate, MoneyInput, Select } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, EmptyView, Field, LoadingView, Row, Screen, SectionTitle } from "@/components/ui";
import { api, ApiError, newKey } from "@/lib/api";
import { dateLabel, rupees, todayIst } from "@/lib/format";
import type { Lookups, Paged } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

interface OpenInvoice { id: string; number: string | null; status: string; dueDate: string | null; total: string; balance: string }
const paise = (s: string) => Math.round(Number(s || 0) * 100);
const fromPaise = (p: number) => (p / 100).toFixed(2);

/** Record money received and allocate it to issued invoices. Any remainder is kept as customer credit. */
export default function RecordPayment() {
  const params = useLocalSearchParams<{ customerId?: string; invoiceId?: string }>();
  const router = useRouter();
  const lk = useLoad(() => api.get<Lookups>("/lookups"));
  const [customerId, setCustomerId] = useState<string | null>(params.customerId ?? null);
  const open = useLoad(() => (customerId ? api.get<Paged<OpenInvoice>>("/invoices", { customerId, status: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"], pageSize: 100 }) : Promise.resolve(null)), [customerId]);
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(todayIst());
  const [mode, setMode] = useState("NEFT");
  const [reference, setReference] = useState("");
  // User edits per invoice; everything else follows the automatic oldest-first allocation.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());

  const invoices = useMemo(() => [...(open.data?.items ?? [])].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")), [open.data]);
  const auto = useMemo(() => {
    const next: Record<string, string> = {};
    if (!isMoney(amount)) return next;
    let left = paise(amount);
    const ordered = params.invoiceId ? [...invoices.filter((i) => i.id === params.invoiceId), ...invoices.filter((i) => i.id !== params.invoiceId)] : invoices;
    for (const i of ordered) {
      const take = Math.min(left, paise(i.balance));
      if (take > 0) next[i.id] = fromPaise(take);
      left -= take;
    }
    return next;
  }, [amount, invoices, params.invoiceId]);
  const alloc: Record<string, string> = { ...auto, ...overrides };

  const allocated = Object.values(alloc).reduce((s, v) => s + paise(v), 0);
  const credit = paise(amount) - allocated;
  const overLine = invoices.find((i) => paise(alloc[i.id] ?? "0") > paise(i.balance));
  const valid = customerId && isMoney(amount) && paise(amount) > 0 && isValidDate(receivedOn) && credit >= 0 && !overLine && Object.values(alloc).every((v) => !v || isMoney(v));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/payments", {
        customerId,
        receivedOn,
        amount,
        mode,
        reference: reference.trim() || undefined,
        idempotencyKey: key.current,
        allocations: Object.entries(alloc).filter(([, v]) => paise(v) > 0).map(([invoiceId, v]) => ({ invoiceId, amount: v })),
      });
      router.replace({ pathname: "/finance", params: { view: "payments" } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The payment was not recorded.");
      // An unconfirmed request keeps its key so a retry cannot record the payment twice.
      if (!(e instanceof ApiError && e.kind === "uncertain")) key.current = newKey();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppHeader back title="Record payment" eyebrow="Collections" />
      <Screen footer={<Btn variant="accent" icon="save" label={`Record ${amount && isMoney(amount) ? rupees(amount, { paise: true }) : "payment"}`} onPress={save} loading={busy} disabled={!valid} />}>
        {error && <Banner tone="danger" title="Not recorded" body={error} />}
        <FormSection step="01" title="Payment received">
          {lk.data ? <Select label="Customer" required searchable value={customerId} onChange={(v) => { setCustomerId(v); setOverrides({}); }} options={lk.data.customers.map((c) => ({ value: c.id, label: c.name }))} /> : <LoadingView />}
          <MoneyInput label="Amount received" required value={amount} onChange={(v) => { setAmount(v); setOverrides({}); }} />
          <DateInput label="Received on" required value={receivedOn} onChange={setReceivedOn} />
          <Select label="Mode" value={mode} onChange={setMode} options={(lk.data?.paymentModes ?? ["NEFT"]).map((m) => ({ value: m, label: m }))} />
          <Field label="Reference / UTR / cheque no." value={reference} onChangeText={setReference} autoCapitalize="characters" />
        </FormSection>
        {customerId && (
          <>
            <SectionTitle icon="call-split">Allocate to invoices</SectionTitle>
            {open.loading ? (
              <LoadingView />
            ) : invoices.length === 0 ? (
              <EmptyView icon="receipt-long" title="No open invoices" body="The full amount will be kept as customer credit and can be allocated later." />
            ) : (
              invoices.map((i) => (
                <Card key={i.id}>
                  <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.labelLg, { color: color.ink }]}>{i.number}</Text>
                      <Text style={[type.bodySm, { color: i.status === "OVERDUE" ? color.dangerText : color.muted }]}>Balance {rupees(i.balance, { paise: true })}{i.dueDate ? ` · due ${dateLabel(i.dueDate)}` : ""}</Text>
                    </View>
                    <View style={{ width: 150 }}>
                      <MoneyInput label="Allocate" value={alloc[i.id] ?? ""} onChange={(v) => setOverrides((a) => ({ ...a, [i.id]: v }))} error={paise(alloc[i.id] ?? "0") > paise(i.balance) ? "More than due" : null} />
                    </View>
                  </View>
                </Card>
              ))
            )}
            <Card>
              <Row label="Allocated to invoices" value={rupees(fromPaise(allocated), { paise: true })} />
              <Row label={credit < 0 ? "Over-allocated" : "Kept as customer credit"} value={rupees(fromPaise(Math.abs(credit)), { paise: true })} strong />
              {credit < 0 && <Text style={[type.bodySm, { color: color.dangerText }]}>Allocations add up to more than the amount received.</Text>}
            </Card>
          </>
        )}
      </Screen>
    </>
  );
}
