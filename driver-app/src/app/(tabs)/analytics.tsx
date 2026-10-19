import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AppHeader, Banner, Btn, Card, Chips, ErrorView, Icon, LoadingView, Metric, Row, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, hours, monthLabel, rupees, shiftMonth, todayIst } from "@/lib/format";
import type { MonthSummary } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

export default function Analytics() {
  const router = useRouter();
  const thisMonth = todayIst().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [view, setView] = useState<"month" | "day">("month");
  const q = useLoad(() => api.summary(month), [month]);
  const [selected, setSelected] = useState<string | null>(null);

  const header = <AppHeader title="Analytics" eyebrow="Hours & working days" />;
  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: color.white, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: 4 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => { setMonth(shiftMonth(month, -1)); setSelected(null); }} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
            <Icon name="chevron-left" />
          </Pressable>
          <Text style={[type.headlineSm, { color: color.ink, fontFamily: font.bold }]}>{monthLabel(month)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next month" disabled={month >= thisMonth} onPress={() => { setMonth(shiftMonth(month, 1)); setSelected(null); }} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center", opacity: month >= thisMonth ? 0.3 : 1 }}>
            <Icon name="chevron-right" />
          </Pressable>
        </View>
        <Chips value={view} onChange={setView} options={[{ value: "month", label: "Monthly summary" }, { value: "day", label: "Daily breakdown" }]} />

        {q.loading ? (
          <LoadingView />
        ) : !q.data ? (
          <ErrorView error={q.error!} onRetry={q.reload} />
        ) : view === "month" ? (
          <MonthView s={q.data} onEarnings={() => router.push("/earnings")} />
        ) : (
          <DayView s={q.data} selected={selected} onSelect={setSelected} />
        )}
      </Screen>
    </>
  );
}

function MonthView({ s, onEarnings }: { s: MonthSummary; onEarnings: () => void }) {
  const max = Math.max(1, ...s.days.map((d) => Number(d.approvedHours) + Number(d.pendingHours)));
  return (
    <>
      <Card accent={color.accent}>
        <View style={{ paddingLeft: 6, gap: 4 }}>
          <Text style={[type.labelSm, { color: color.muted }]}>Earnings from approved hours</Text>
          <Text style={[type.displayLg, { color: color.ink }]}>{rupees(s.approvedEarnings)}</Text>
          <Text style={[type.bodySm, { color: color.muted }]}>Approved hours × your rate on each work date. Adjustments and final net pay are shown in payroll.</Text>
          <Btn compact variant="outline" icon="receipt-long" label="Salary & payment history" onPress={onEarnings} />
        </View>
      </Card>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <Card style={{ flex: 1 }}><Metric label="Approved hours" value={Number(s.approvedHours).toFixed(1)} unit="h" tone="success" sub={`${s.approvedJobs} jobs`} /></Card>
        <Card style={{ flex: 1 }}><Metric label="Working days" value={String(s.workingDays)} sub="Distinct dates with approved work" /></Card>
      </View>
      <Card>
        <Metric label="Pending approval" value={Number(s.pendingHours).toFixed(1)} unit="h" tone="warning" sub={`${s.pendingJobs} jobs awaiting review or correction. Not counted for pay yet.`} />
      </Card>

      <SectionTitle icon="bar-chart">Daily machine hours</SectionTitle>
      <Card>
        {s.days.length === 0 ? (
          <Text style={[type.bodyMd, { color: color.muted }]}>No submitted work this month.</Text>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: 140 }} accessibilityLabel="Bar chart of hours per day">
              {s.days.map((d) => {
                const a = Number(d.approvedHours);
                const p = Number(d.pendingHours);
                return (
                  <View key={d.date} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" }} accessible accessibilityLabel={`${dateLabel(d.date)}: ${a} approved, ${p} pending hours`}>
                    {p > 0 && <View style={{ width: "100%", height: `${(p / max) * 100}%`, backgroundColor: color.accentSoft, borderWidth: 1, borderColor: color.warning, borderStyle: "dashed", borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />}
                    {a > 0 && <View style={{ width: "100%", height: `${(a / max) * 100}%`, backgroundColor: color.accent, borderTopLeftRadius: p > 0 ? 0 : 3, borderTopRightRadius: p > 0 ? 0 : 3 }} />}
                    <Text style={{ fontFamily: font.semibold, fontSize: 9, color: color.muted, marginTop: 2 }}>{Number(d.date.slice(8))}</Text>
                  </View>
                );
              })}
            </View>
            <View style={{ flexDirection: "row", gap: space.lg }}>
              <Legend swatch={color.accent} label="Approved" />
              <Legend swatch={color.accentSoft} label="Pending" dashed />
            </View>
          </>
        )}
      </Card>
    </>
  );
}

function Legend({ swatch, label, dashed }: { swatch: string; label: string; dashed?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: swatch, borderWidth: dashed ? 1 : 0, borderColor: color.warning, borderStyle: "dashed" }} />
      <Text style={[type.labelMd, { color: color.navy }]}>{label}</Text>
    </View>
  );
}

function DayView({ s, selected, onSelect }: { s: MonthSummary; selected: string | null; onSelect: (d: string) => void }) {
  const [y, m] = s.month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const offset = (first + 6) % 7; // Monday first
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDate = new Map(s.days.map((d) => [d.date, d]));
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${s.month}-${String(i + 1).padStart(2, "0")}`)];
  const sel = selected ? byDate.get(selected) : null;
  const today = todayIst();

  return (
    <>
      <Card>
        <View style={{ flexDirection: "row" }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <Text key={d} style={[type.labelSm, { flex: 1, textAlign: "center", color: color.muted }]}>{d}</Text>
          ))}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {cells.map((date, i) => {
            if (!date) return <View key={`e${i}`} style={{ width: `${100 / 7}%`, height: 52 }} />;
            const d = byDate.get(date);
            const total = d ? Number(d.approvedHours) + Number(d.pendingHours) : 0;
            const isSel = date === selected;
            return (
              <Pressable
                key={date}
                onPress={() => onSelect(date)}
                accessibilityRole="button"
                accessibilityLabel={`${dateLabel(date)}${d ? `, ${total} hours` : ", no work"}`}
                style={{ width: `${100 / 7}%`, height: 52, padding: 2 }}
              >
                <View style={{ flex: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: isSel ? color.navy : d ? (Number(d.pendingHours) > 0 ? color.accentSoft : color.successBg) : "transparent", borderWidth: date === today ? 1.5 : 0, borderColor: color.accent }}>
                  <Text style={[type.labelLg, { color: isSel ? color.white : color.ink }]}>{Number(date.slice(8))}</Text>
                  {d ? <Text style={{ fontFamily: font.semibold, fontSize: 10, color: isSel ? color.accent : color.muted }}>{total.toFixed(1)}h</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {selected ? (
        <Card accent={color.navy}>
          <View style={{ paddingLeft: 6, gap: 4 }}>
            <Text style={[type.headlineSm, { color: color.ink, fontFamily: font.bold }]}>{dateLabel(selected)}</Text>
            {sel ? (
              <>
                <Row label="Approved hours" value={hours(sel.approvedHours)} strong />
                <Row label="Approved jobs" value={String(sel.approvedJobs)} />
                <Row label="Pending hours" value={hours(sel.pendingHours)} />
                <Row label="Pending jobs" value={String(sel.pendingJobs)} />
                <Text style={[type.bodySm, { color: color.muted }]}>
                  {sel.approvedJobs > 0 ? "Counts as 1 working day, however many jobs were done on this date." : "Counts as a working day once the work is approved."}
                </Text>
              </>
            ) : (
              <Text style={[type.bodyMd, { color: color.muted }]}>No submitted work on this date.</Text>
            )}
          </View>
        </Card>
      ) : (
        <Banner tone="info" title="Tap a date" body="See approved and pending hours for that day." />
      )}
    </>
  );
}
