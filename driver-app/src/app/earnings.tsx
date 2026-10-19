import { Text, View } from "react-native";
import { AppHeader, Badge, Banner, Card, EmptyView, ErrorView, LoadingView, Metric, Row, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, hours, payTerms, rupees, shortDate, timeLabel } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

export default function Earnings() {
  const q = useLoad(() => api.earnings());
  const header = <AppHeader back title="Earnings" eyebrow="Salary ledger" />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const e = q.data;

  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        <Banner
          tone="info"
          icon="calculate"
          title="How pay is calculated"
          body={
            e.compensation?.method === "FIXED"
              ? "Net pay = your monthly salary + authorized additions − authorized deductions. Approved hours are recorded but do not change a fixed salary."
              : "Net pay = approved hours × your rate on each work date + authorized additions − authorized deductions. Pending or rejected hours are never paid."
          }
        />

        <Card accent={color.accent}>
          <View style={{ paddingLeft: 6, gap: space.sm }}>
            <Text style={[type.labelSm, { color: color.muted }]}>Approved, not yet in payroll</Text>
            <Text style={[type.displayLg, { color: color.ink }]}>{rupees(e.notYetInPayroll.amount)}</Text>
            <View style={{ flexDirection: "row", gap: space.md }}>
              <Metric label="Hours" value={Number(e.notYetInPayroll.hours).toFixed(1)} />
              <Metric label="Working days" value={String(e.notYetInPayroll.workingDays)} />
              <Metric label="Jobs" value={String(e.notYetInPayroll.jobs)} />
            </View>
            <Text style={[type.bodySm, { color: color.muted }]}>Gross amount before adjustments. The office includes it in the next payroll run.</Text>
          </View>
        </Card>

        <SectionTitle icon="receipt-long">Payroll history</SectionTitle>
        {e.payrolls.length === 0 ? (
          <Card><EmptyView icon="receipt-long" title="No payroll runs yet" body="Approved and paid salary periods will appear here." /></Card>
        ) : (
          e.payrolls.map((p) => (
            <Card key={p.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={[type.headlineSm, { color: color.ink }]}>{shortDate(p.periodStart)} – {dateLabel(p.periodEnd)}</Text>
                <Badge label={p.status === "PAID" ? "Paid" : "Approved"} tone={p.status === "PAID" ? "success" : "info"} />
              </View>
              <Row label={`${hours(p.approvedHours)} · ${p.workingDays} working days`} value={rupees(p.grossAmount, { paise: true })} />
              {p.adjustments.map((a, i) => (
                <Row key={i} label={`${a.kind === "ADDITION" ? "+" : "−"} ${a.description}`} value={`${a.kind === "ADDITION" ? "+" : "−"}${rupees(a.amount, { paise: true })}`} />
              ))}
              <View style={{ height: 1, backgroundColor: color.border }} />
              <Row label="Net payable" value={rupees(p.netAmount, { paise: true })} strong />
              {p.status === "PAID" && (
                <Text style={[type.bodySm, { color: color.successText }]}>
                  Paid {p.paidAt ? timeLabel(p.paidAt) : ""}{p.paymentMode ? ` via ${p.paymentMode}` : ""}{p.paymentRef ? ` · Ref ${p.paymentRef}` : ""}
                </Text>
              )}
            </Card>
          ))
        )}

        <SectionTitle icon="trending-up">Pay terms history</SectionTitle>
        <Card>
          {e.compensationHistory.length === 0 ? (
            <Text style={[type.bodyMd, { color: color.muted }]}>No pay terms set.</Text>
          ) : (
            e.compensationHistory.map((r) => <Row key={r.effectiveFrom} label={`From ${dateLabel(r.effectiveFrom)}`} value={payTerms(r)} />)
          )}
          <Text style={[type.bodySm, { color: color.muted }]}>A change applies only to work on or after its start date.</Text>
        </Card>
      </Screen>
    </>
  );
}
