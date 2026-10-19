import { useState } from "react";
import { Text, View } from "react-native";
import { ConfirmDialog, FormSection, Grid, StatusBadge, Toggle, useFlash } from "@/components/kit";
import { AppHeader, Banner, Btn, Card, ErrorView, Field, LoadingView, Row, Screen, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { timeLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

interface Profile { legalName: string | null; tradeName: string | null; gstin: string | null; stateCode: string | null; address: string | null; phone: string | null; email: string | null; bankDetails: string | null; invoicePrefix: string; invoiceTerms: string | null; verificationStatus: string; verifiedAt: string | null }
interface Rule { id: string; name: string; sacCode: string | null; cgstRate: string | null; sgstRate: string | null; igstRate: string | null; notes: string | null; active: boolean; verificationStatus: string; verifiedAt: string | null }
const KEYS: (keyof Profile)[] = ["legalName", "tradeName", "gstin", "stateCode", "address", "phone", "email", "bankDetails", "invoicePrefix", "invoiceTerms"];

/** Business profile and tax rules, with explicit verification before tax invoices can be issued. */
export default function TaxSettings() {
  const { can } = useSession();
  const flash = useFlash();
  const q = useLoad(() => Promise.all([api.get<Profile>("/settings/business"), api.get<Rule[]>("/settings/tax-rules")]));
  const [verify, setVerify] = useState<{ kind: "profile" } | { kind: "rule"; rule: Rule } | null>(null);
  const [ruleEdit, setRuleEdit] = useState<Rule | "new" | null>(null);

  const header = <AppHeader back title="Business profile & tax" eyebrow="Settings" />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const [profile, rules] = q.data;
  const verifiedRules = rules.filter((r) => r.active && r.verificationStatus === "VERIFIED");
  const ready = profile.verificationStatus === "VERIFIED" && verifiedRules.length > 0;

  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        {flash.node}
        <Banner
          tone={ready ? "success" : "danger"}
          title={ready ? "Tax invoices can be issued" : "Tax invoices are blocked until verified"}
          body={ready ? "The business profile and at least one tax rule are verified." : "The tax treatment has not been confirmed. Enter the details your accountant has confirmed, then have an authorized person verify them. Proforma invoices can still be issued."}
        />
        <Grid max={2}>
          <ProfileForm key={JSON.stringify(profile)} profile={profile} canVerify={can("TAX_VERIFY")} onVerify={() => setVerify({ kind: "profile" })} onSaved={q.refresh} flash={flash} />
          <View style={{ gap: space.md }}>
            <SectionTitle icon="percent" right={<Btn compact variant="ghost" label="Add rule" onPress={() => setRuleEdit("new")} />}>Tax rules</SectionTitle>
            <Text style={[type.bodySm, { color: color.muted }]}>No GST rate or SAC code is assumed. Enter exactly what your accountant confirms. Editing a rule resets its verification.</Text>
            {rules.map((r) => (
              <Card key={r.id} accent={r.verificationStatus === "VERIFIED" ? color.success : color.danger}>
                <View style={{ paddingLeft: 6, gap: 4 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                    <Text style={[type.labelLg, { color: color.ink, flex: 1 }]}>{r.name}</Text>
                    <StatusBadge status={r.verificationStatus} />
                  </View>
                  <Row label="SAC" value={r.sacCode ?? "—"} />
                  <Row label="CGST / SGST" value={r.cgstRate ? `${r.cgstRate}% + ${r.sgstRate}%` : "—"} />
                  <Row label="IGST" value={r.igstRate ? `${r.igstRate}%` : "—"} />
                  {r.notes && <Text style={[type.bodySm, { color: color.muted }]}>{r.notes}</Text>}
                  {!r.active && <Text style={[type.bodySm, { color: color.muted }]}>Inactive</Text>}
                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    <Btn compact variant="outline" label="Edit" onPress={() => setRuleEdit(r)} />
                    {can("TAX_VERIFY") && r.verificationStatus !== "VERIFIED" && <Btn compact variant="accent" label="Verify" onPress={() => setVerify({ kind: "rule", rule: r })} />}
                  </View>
                </View>
              </Card>
            ))}
          </View>
        </Grid>
      </Screen>
      <ConfirmDialog
        visible={!!verify}
        title={verify?.kind === "profile" ? "Verify business profile" : `Verify "${verify?.kind === "rule" ? verify.rule.name : ""}"`}
        body="Confirm these details were checked against official records or confirmed by your accountant. Your name and this note are recorded in the audit log."
        confirmLabel="Verify"
        reasonLabel="How it was verified (e.g. 'Confirmed by CA R. Mehta on 18 Oct 2026, email')"
        minReason={10}
        onCancel={() => setVerify(null)}
        onConfirm={async (confirmation) => {
          if (verify!.kind === "profile") await api.post("/settings/business/verify", { confirmation });
          else await api.post(`/settings/tax-rules/${verify!.rule.id}/verify`, { confirmation });
          setVerify(null);
          flash.ok("Verified");
          await q.refresh();
        }}
      />
      {ruleEdit && <RuleDialog rule={ruleEdit === "new" ? null : ruleEdit} onClose={() => setRuleEdit(null)} onSaved={async () => { setRuleEdit(null); flash.ok("Tax rule saved", "It must be verified before use on a tax invoice."); await q.refresh(); }} />}
    </>
  );
}

function RuleDialog({ rule, onClose, onSaved }: { rule: Rule | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(rule?.name ?? "");
  const [sac, setSac] = useState(rule?.sacCode ?? "");
  const [cgst, setCgst] = useState(rule?.cgstRate ?? "");
  const [sgst, setSgst] = useState(rule?.sgstRate ?? "");
  const [igst, setIgst] = useState(rule?.igstRate ?? "");
  const [notes, setNotes] = useState(rule?.notes ?? "");
  const [active, setActive] = useState(rule?.active ?? true);
  const pct = (v: string) => !v || /^\d{1,2}(\.\d{1,2})?$/.test(v);
  return (
    <ConfirmDialog
      visible
      title={rule ? "Edit tax rule" : "Add tax rule"}
      body="Saving leaves the rule unverified."
      confirmLabel="Save"
      onCancel={onClose}
      onConfirm={async () => {
        if (name.trim().length < 2 || ![cgst, sgst, igst].every(pct)) throw new Error("Enter a name and rates like 9 or 2.5.");
        const body = { name: name.trim(), sacCode: sac || null, cgstRate: cgst || null, sgstRate: sgst || null, igstRate: igst || null, notes: notes || null, active };
        if (rule) await api.patch(`/settings/tax-rules/${rule.id}`, body);
        else await api.post("/settings/tax-rules", body);
        onSaved();
      }}
    >
      <Field label="Name" required value={name} onChangeText={setName} placeholder="e.g. Machinery hire with operator" />
      <Field label="SAC code" value={sac} onChangeText={setSac} keyboardType="number-pad" />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}><Field label="CGST %" value={cgst} onChangeText={setCgst} keyboardType="decimal-pad" /></View>
        <View style={{ flex: 1 }}><Field label="SGST %" value={sgst} onChangeText={setSgst} keyboardType="decimal-pad" /></View>
        <View style={{ flex: 1 }}><Field label="IGST %" value={igst} onChangeText={setIgst} keyboardType="decimal-pad" /></View>
      </View>
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      {rule && <Toggle label="Active" value={active} onChange={setActive} />}
    </ConfirmDialog>
  );
}

function ProfileForm({ profile, canVerify, onVerify, onSaved, flash }: { profile: Profile; canVerify: boolean; onVerify: () => void; onSaved: () => Promise<void>; flash: ReturnType<typeof useFlash> }) {
  const [p, setP] = useState<Record<string, string>>(() => Object.fromEntries(KEYS.map((k) => [k, (profile[k] as string | null) ?? ""])));
  const [saving, setSaving] = useState(false);
  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.put("/settings/business", Object.fromEntries(KEYS.map((k) => [k, p[k]?.trim() || (k === "invoicePrefix" ? "AJ" : null)])));
      flash.ok("Profile saved", "Changes reset verification. Verify again before issuing tax invoices.");
      await onSaved();
    } catch (e) {
      flash.fail(e);
    } finally {
      setSaving(false);
    }
  };
  return (
  <FormSection title="Business profile" right={<StatusBadge status={profile.verificationStatus} />}>
      <Field label="Legal name" value={p.legalName ?? ""} onChangeText={(v) => setP((s) => ({ ...s, legalName: v }))} />
      <Field label="Trade name" value={p.tradeName ?? ""} onChangeText={(v) => setP((s) => ({ ...s, tradeName: v }))} />
      <Field label="GSTIN" value={p.gstin ?? ""} onChangeText={(v) => setP((s) => ({ ...s, gstin: v.toUpperCase() }))} autoCapitalize="characters" maxLength={15} />
      <Field label="State code" value={p.stateCode ?? ""} onChangeText={(v) => setP((s) => ({ ...s, stateCode: v }))} keyboardType="number-pad" maxLength={2} />
      <Field label="Registered address" value={p.address ?? ""} onChangeText={(v) => setP((s) => ({ ...s, address: v }))} multiline />
      <Field label="Phone" value={p.phone ?? ""} onChangeText={(v) => setP((s) => ({ ...s, phone: v }))} keyboardType="phone-pad" />
      <Field label="Email" value={p.email ?? ""} onChangeText={(v) => setP((s) => ({ ...s, email: v }))} autoCapitalize="none" keyboardType="email-address" />
      <Field label="Bank details (printed on invoices)" value={p.bankDetails ?? ""} onChangeText={(v) => setP((s) => ({ ...s, bankDetails: v }))} multiline />
      <Field label="Invoice number prefix" value={p.invoicePrefix ?? ""} onChangeText={(v) => setP((s) => ({ ...s, invoicePrefix: v.toUpperCase() }))} autoCapitalize="characters" maxLength={8} hint="Numbers look like AJ/2026-27/0001 (proformas: AJ-PF/…)." />
      <Field label="Invoice terms" value={p.invoiceTerms ?? ""} onChangeText={(v) => setP((s) => ({ ...s, invoiceTerms: v }))} multiline />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}><Btn variant="dark" icon="save" label="Save profile" onPress={saveProfile} loading={saving} /></View>
        {canVerify && profile.verificationStatus !== "VERIFIED" && <View style={{ flex: 1 }}><Btn variant="accent" icon="verified" label="Verify" onPress={onVerify} /></View>}
      </View>
      {profile.verifiedAt && <Text style={[type.bodySm, { color: color.successText }]}>Verified {timeLabel(profile.verifiedAt)}</Text>}
    </FormSection>
  );
}
