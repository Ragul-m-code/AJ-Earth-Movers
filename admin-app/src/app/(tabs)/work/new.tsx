import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { DateInput, FormSection, Grid, isValidDate, Select, Toggle } from "@/components/kit";
import { AppHeader, Banner, Btn, ErrorView, Field, LoadingView, Screen } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { todayIst } from "@/lib/format";
import type { Lookups, WorkOrderDetail } from "@/lib/types";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

export default function CreateWorkOrder() {
  const router = useRouter();
  const lk = useLoad(() => api.get<Lookups>("/lookups"));
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [siteName, setSiteName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [workDate, setWorkDate] = useState(todayIst());
  const [shiftLabel, setShiftLabel] = useState("Day shift");
  const [plannedHours, setPlannedHours] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const header = <AppHeader back title="Create work order" eyebrow="New dispatch" />;
  if (lk.loading) return <>{header}<LoadingView /></>;
  if (!lk.data) return <>{header}<ErrorView error={lk.error!} onRetry={lk.reload} /></>;
  const L = lk.data;
  const customer = L.customers.find((c) => c.id === customerId);
  const vehicle = L.vehicles.find((v) => v.id === vehicleId);

  const problems = {
    customer: !customerId ? "Choose the customer." : null,
    site: !siteId && !siteName.trim() ? "Choose a site or type the job location." : null,
    vehicle: !vehicleId ? "Choose the machine." : null,
    driver: !driverId ? "Choose the operator." : null,
    date: !isValidDate(workDate) ? "Enter a valid date." : null,
    hours: plannedHours && !/^\d{1,2}(\.\d)?$/.test(plannedHours) ? "Planned hours like 8 or 8.5." : null,
  };
  const show = (k: keyof typeof problems) => (touched ? problems[k] : null);

  const submit = async () => {
    setTouched(true);
    if (Object.values(problems).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      const wo = await api.post<WorkOrderDetail>("/work-orders", {
        customerId,
        vehicleId,
        driverId,
        workDate,
        siteId: siteId ?? undefined,
        siteName: siteId ? undefined : siteName.trim(),
        siteAddress: siteId ? undefined : siteAddress.trim() || undefined,
        shiftLabel: shiftLabel.trim() || undefined,
        plannedHours: plannedHours || undefined,
        instructions: instructions.trim() || undefined,
        attachmentIds,
      });
      router.replace(`/work/${wo.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The work order was not created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {header}
      <Screen footer={<Btn variant="accent" icon="check-circle-outline" label="Create work order" onPress={submit} loading={busy} />}>
        {error && <Banner tone="danger" title="Not created" body={error} />}
        <Grid max={2}>
          <FormSection step="01" title="Customer & site">
            <Select label="Customer" required searchable value={customerId} onChange={(v) => { setCustomerId(v); setSiteId(null); }} options={L.customers.map((c) => ({ value: c.id, label: c.name }))} error={show("customer")} />
            {customer && customer.sites.length > 0 && (
              <Select
                label="Site"
                value={siteId ?? "__other"}
                onChange={(v) => setSiteId(v === "__other" ? null : v)}
                options={[...customer.sites.map((s) => ({ value: s.id, label: s.name, hint: s.address ?? undefined })), { value: "__other", label: "Other location (type below)" }]}
              />
            )}
            {!siteId && (
              <>
                <Field label="Job location" required value={siteName} onChangeText={setSiteName} placeholder="e.g. Hinjawadi Phase 3, plot 41" error={show("site")} />
                <Field label="Address (optional)" value={siteAddress} onChangeText={setSiteAddress} multiline />
              </>
            )}
          </FormSection>

          <FormSection step="02" title="Machine & operator">
            <Select
              label="Machine"
              required
              searchable
              value={vehicleId}
              onChange={setVehicleId}
              options={L.vehicles.map((v) => ({ value: v.id, label: `${v.unitCode} · ${v.make} ${v.model}`, hint: `${v.registrationNo} · ${v.category}${v.status !== "AVAILABLE" ? ` · ${v.status.toLowerCase()}` : ""}`, disabled: v.status !== "AVAILABLE" }))}
              error={show("vehicle")}
            />
            <Select label="Operator" required searchable value={driverId} onChange={setDriverId} options={L.drivers.map((d) => ({ value: d.id, label: d.fullName, hint: `${d.driverCode} · ${d.phone}` }))} error={show("driver")} />
            <Text style={[type.labelSm, { color: color.navy }]}>Attachments</Text>
            {L.attachments.length === 0 && <Text style={[type.bodySm, { color: color.muted }]}>No attachments registered.</Text>}
            {L.attachments.map((a) => (
              <Toggle
                key={a.id}
                label={`${a.name} (${a.code})`}
                hint={a.chargeable ? "Billable: adds the breaker/attachment surcharge for approved breaker hours" : "Not billable"}
                value={attachmentIds.includes(a.id)}
                onChange={(on) => setAttachmentIds((ids) => (on ? [...ids, a.id] : ids.filter((x) => x !== a.id)))}
              />
            ))}
          </FormSection>

          <FormSection step="03" title="Schedule & scope">
            <DateInput label="Work date" required value={workDate} onChange={setWorkDate} error={show("date")} />
            <Field label="Shift" value={shiftLabel} onChangeText={setShiftLabel} placeholder="e.g. Day shift (08:00–18:00)" />
            <Field label="Planned hours (optional)" value={plannedHours} onChangeText={setPlannedHours} keyboardType="decimal-pad" error={show("hours")} hint="For planning only. Billing always uses approved meter hours." />
          </FormSection>

          <FormSection step="04" title="Instructions for the operator">
            <Field label="Scope of work" value={instructions} onChangeText={setInstructions} multiline maxLength={2000} placeholder="e.g. Trench excavation along the service road. Report to the site supervisor at gate 3." />
            {vehicle && <Banner tone="info" title={`Billing for ${vehicle.unitCode}`} body="The customer's agreed rate (or the machine's default rate) on the work date is applied when invoicing approved hours." />}
          </FormSection>
        </Grid>
        <View style={{ height: space.md }} />
      </Screen>
    </>
  );
}
