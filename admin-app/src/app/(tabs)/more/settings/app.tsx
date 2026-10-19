import { useState } from "react";
import { Text, View } from "react-native";
import { FormSection, useFlash } from "@/components/kit";
import { AppHeader, Banner, Btn, ErrorView, Field, LoadingView, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { bytesLabel, type StorageUsage } from "@/lib/storage";
import { useLoad } from "@/lib/useLoad";
import { color, type } from "@/theme";

const LABELS: Record<string, { label: string; hint: string; numeric?: boolean }> = {
  "meter.maxJobHours": { label: "Maximum hours for one job", hint: "Readings above this are flagged for review (not rejected). Placeholder until you confirm a value.", numeric: true },
  "meter.elapsedToleranceHours": { label: "Clock-time tolerance (hours)", hint: "Meter hours may exceed the time between start and end submissions by this much before being flagged.", numeric: true },
  "contact.dispatchPhone": { label: "Dispatch desk phone", hint: "Shown to drivers in Help." },
  "contact.payrollPhone": { label: "Payroll queries phone", hint: "Shown to drivers in Help." },
  "contact.emergencyPhone": { label: "Emergency number", hint: "National emergency is 112." },
  "storage.photoQuotaGb": { label: "Photo storage quota (GB)", hint: "Set this to your storage plan's size. Owners are alerted at 80% and 95%.", numeric: true },
};

type Setting = { key: string; value: string | null; isDefault: boolean };

export default function AppSettings() {
  const q = useLoad(() => api.get<Setting[]>("/settings/app"));
  if (q.loading) return <><AppHeader back title="Operational settings" /><LoadingView /></>;
  if (!q.data) return <><AppHeader back title="Operational settings" /><ErrorView error={q.error!} onRetry={q.reload} /></>;
  return <SettingsBody key={JSON.stringify(q.data)} settings={q.data} reload={q.refresh} />;
}

function SettingsBody({ settings, reload }: { settings: Setting[]; reload: () => Promise<void> }) {
  const flash = useFlash();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(settings.map((s) => [s.key, s.value ?? ""])));
  const [saving, setSaving] = useState<string | null>(null);
  return (
    <>
      <AppHeader back title="Operational settings" eyebrow="Settings" />
      <Screen>
        {flash.node}
        <FormSection title="Meter checks & contacts">
          {settings.map((s) => (
            <Field
              key={s.key}
              label={LABELS[s.key]?.label ?? s.key}
              value={values[s.key] ?? ""}
              onChangeText={(v) => setValues((x) => ({ ...x, [s.key]: v }))}
              keyboardType={LABELS[s.key]?.numeric ? "decimal-pad" : "phone-pad"}
              hint={`${LABELS[s.key]?.hint ?? ""}${s.isDefault ? " (currently the default)" : ""}`}
              onEndEditing={async () => {
                if ((values[s.key] ?? "") === (s.value ?? "")) return;
                setSaving(s.key);
                try {
                  await api.put(`/settings/app/${s.key}`, { value: values[s.key] || null });
                  flash.ok("Saved");
                  await reload();
                } catch (e) {
                  flash.fail(e);
                } finally {
                  setSaving(null);
                }
              }}
            />
          ))}
          <Text style={[type.bodySm, { color: color.muted }]}>{saving ? "Saving…" : "Each value saves when you leave the field. Changes are recorded in the audit log."}</Text>
        </FormSection>
        <StorageMeter />
        <Btn variant="outline" icon="refresh" label="Reload" onPress={reload} />
      </Screen>
    </>
  );
}

/** Meter-photo storage against the quota. Photos are compressed on the phone and never re-encoded afterwards (they are evidence). */
function StorageMeter() {
  const q = useLoad(() => api.get<StorageUsage>("/settings/storage"));
  const u = q.data;
  const tint = u?.level === "critical" ? color.danger : u?.level === "warning" ? color.warning : color.success;
  return (
    <FormSection title="Photo storage">
      {!u ? (
        <Text style={[type.bodySm, { color: color.muted }]}>{q.loading ? "Checking usage…" : "Usage is unavailable right now."}</Text>
      ) : (
        <>
          <Text style={[type.headlineSm, { color: color.ink }]}>
            {bytesLabel(u.usedBytes)} of {bytesLabel(u.quotaBytes)} · {u.percent}%
          </Text>
          <View style={{ height: 10, borderRadius: 5, backgroundColor: color.recessed, overflow: "hidden" }} accessibilityLabel={`Storage ${u.percent} percent used`}>
            <View style={{ width: `${Math.min(100, u.percent)}%`, height: "100%", backgroundColor: tint }} />
          </View>
          <Text style={[type.bodySm, { color: color.muted }]}>
            {u.photoCount} meter photo(s).{u.daysUntilFull !== null ? ` At the last 30 days' rate, the quota lasts about ${u.daysUntilFull} more day(s).` : ""}
          </Text>
          {u.level !== "ok" && (
            <Banner tone={u.level === "critical" ? "danger" : "warning"} title="Increase storage" body="Upgrade the storage plan, then raise the quota above. Photos are billing evidence and are not deleted or re-compressed automatically." />
          )}
        </>
      )}
    </FormSection>
  );
}
