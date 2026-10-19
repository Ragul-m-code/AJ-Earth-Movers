import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { DateInput, FormSection, Grid, isMoney, isValidDate, MoneyInput, Segmented } from "@/components/kit";
import { AppHeader, Banner, Btn, Field, LoadingView, Screen } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { todayIst } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";

interface Form { fullName: string; phone: string; emergencyContact: string; licenseNumber: string; licenseExpiry: string; joinedOn: string; address: string }
const EMPTY: Form = { fullName: "", phone: "", emergencyContact: "", licenseNumber: "", licenseExpiry: "", joinedOn: "", address: "" };

/** Add or edit a driver (Stitch: admin_add_edit_driver_form). New drivers get a sign-in ID and a one-time PIN. */
export default function DriverForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useLoad(() => (id ? api.get<Record<string, unknown>>(`/drivers/${id}`) : Promise.resolve(null)), [id]);
  if (existing.loading) return <><AppHeader back title="Driver" /><LoadingView /></>;
  return <DriverFormBody key={id ?? "new"} id={id} initial={existing.data} />;
}

const toForm = (e: Record<string, unknown> | null): Form => (e ? (Object.fromEntries(Object.keys(EMPTY).map((k) => [k, e[k] ? String(e[k]) : ""])) as unknown as Form) : EMPTY);

function DriverFormBody({ id, initial }: { id?: string; initial: Record<string, unknown> | null }) {
  const router = useRouter();
  const { can } = useSession();
  const [f, setF] = useState<Form>(() => toForm(initial));
  const [method, setMethod] = useState<"HOURLY" | "FIXED">("HOURLY");
  const [pay, setPay] = useState("");
  const [payFrom, setPayFrom] = useState(todayIst());
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; code: string; pin: string } | null>(null);
  const set = (k: keyof Form) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const errs: Partial<Record<keyof Form | "pay", string>> = {};
  if (f.fullName.trim().length < 2) errs.fullName = "Enter the driver's full name.";
  if (!/^\+?[\d\s-]{10,16}$/.test(f.phone)) errs.phone = "Enter a valid mobile number.";
  if (f.licenseExpiry && !isValidDate(f.licenseExpiry)) errs.licenseExpiry = "YYYY-MM-DD";
  if (f.joinedOn && !isValidDate(f.joinedOn)) errs.joinedOn = "YYYY-MM-DD";
  if (!id && can("PAYROLL") && pay && !isMoney(pay)) errs.pay = "Enter a valid amount.";
  const e = (k: keyof typeof errs) => (touched ? errs[k] : undefined);

  const save = async () => {
    setTouched(true);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    const body = { fullName: f.fullName, phone: f.phone, emergencyContact: f.emergencyContact || null, licenseNumber: f.licenseNumber || null, licenseExpiry: f.licenseExpiry || null, joinedOn: f.joinedOn || null, address: f.address || null };
    try {
      if (id) {
        await api.patch(`/drivers/${id}`, body);
        router.replace(`/more/drivers/${id}`);
      } else {
        const compensation = can("PAYROLL") && pay ? { method, ...(method === "HOURLY" ? { hourlyRate: pay } : { monthlySalary: pay }), effectiveFrom: payFrom, note: "Initial pay terms" } : undefined;
        const r = await api.post<{ driver: { id: string; driverCode: string }; temporaryPin: string }>("/drivers", { ...body, compensation });
        setCreated({ id: r.driver.id, code: r.driver.driverCode, pin: r.temporaryPin });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <>
        <AppHeader back title="Driver added" />
        <Screen footer={<Btn variant="accent" label="Open driver profile" onPress={() => router.replace(`/more/drivers/${created.id}`)} />}>
          <Banner tone="success" title={`Sign-in ID: ${created.code} · Temporary PIN: ${created.pin}`} body="Give these to the driver in person for the AJ Driver app. The PIN is shown only once and can be reset from the profile." />
          {!pay && can("PAYROLL") && <Banner tone="warning" title="No pay terms yet" body="Set pay terms from the driver profile before approving their work." />}
        </Screen>
      </>
    );
  }
  return (
    <>
      <AppHeader back title={id ? "Edit driver" : "Add driver"} eyebrow="Drivers" />
      <Screen footer={<Btn variant="accent" icon="save" label={id ? "Save changes" : "Add driver"} onPress={save} loading={busy} />}>
        {error && <Banner tone="danger" title="Not saved" body={error} />}
        <Grid max={2}>
          <FormSection step="01" title="Personal details">
            <Field label="Full name" required value={f.fullName} onChangeText={set("fullName")} error={e("fullName")} />
            <Field label="Mobile number" required value={f.phone} onChangeText={set("phone")} keyboardType="phone-pad" error={e("phone")} />
            <Field label="Emergency contact" value={f.emergencyContact} onChangeText={set("emergencyContact")} placeholder="Name and number" />
            <Field label="Address" value={f.address} onChangeText={set("address")} multiline />
          </FormSection>
          <FormSection step="02" title="Licence & employment">
            <Field label="Driving licence number" value={f.licenseNumber} onChangeText={set("licenseNumber")} autoCapitalize="characters" />
            <DateInput label="Licence expiry" value={f.licenseExpiry} onChange={set("licenseExpiry")} quick={false} error={e("licenseExpiry")} />
            <DateInput label="Joined on" value={f.joinedOn} onChange={set("joinedOn")} quick={false} error={e("joinedOn")} />
          </FormSection>
          {!id && can("PAYROLL") && (
            <FormSection step="03" title="Pay terms (optional now)">
              <Segmented value={method} onChange={setMethod} options={[{ value: "HOURLY", label: "Hourly (approved hours)" }, { value: "FIXED", label: "Fixed monthly salary" }]} />
              <MoneyInput label={method === "HOURLY" ? "Rate per approved hour" : "Monthly salary"} value={pay} onChange={setPay} error={e("pay")} hint="Independent of customer billing rates." />
              <DateInput label="Effective from" value={payFrom} onChange={setPayFrom} quick={false} />
            </FormSection>
          )}
        </Grid>
      </Screen>
    </>
  );
}
