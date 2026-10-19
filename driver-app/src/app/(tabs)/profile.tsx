import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AppHeader, Banner, Btn, Card, Dialog, ErrorView, Icon, LoadingView, Row, Screen, SectionTitle, type IconName } from "@/components/ui";
import { api } from "@/lib/api";
import { dateLabel, payTerms } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";
import { color, radius, space, type } from "@/theme";

export default function Profile() {
  const router = useRouter();
  const { signOut } = useSession();
  const q = useLoad(() => Promise.all([api.me(), api.workOrders({ group: "active", pageSize: 1 })]));
  const [confirm, setConfirm] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const header = <AppHeader title="Profile" eyebrow="Driver account" />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const [me, active] = q.data;
  const activeJobs = active.groupCounts.active ?? 0;

  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        <Card accent={color.accent}>
          <View style={{ paddingLeft: 6, gap: 4 }}>
            <Text style={[type.labelSm, { color: color.muted }]}>ID {me.driverCode}</Text>
            <Text style={[type.headlineLg, { color: color.ink }]}>{me.fullName}</Text>
            <Text style={[type.bodyMd, { color: color.muted }]}>Status: {me.status.replace("_", " ").toLowerCase()}</Text>
          </View>
        </Card>

        <SectionTitle icon="payments">Pay terms</SectionTitle>
        <Card>
          {me.compensation ? (
            <>
              <Row label={me.compensation.method === "HOURLY" ? "Hourly rate" : "Monthly salary"} value={payTerms(me.compensation)} strong />
              <Row label="Effective from" value={dateLabel(me.compensation.effectiveFrom)} />
            </>
          ) : (
            <Text style={[type.bodyMd, { color: color.muted }]}>No rate is set yet. Contact the office.</Text>
          )}
          <Text style={[type.bodySm, { color: color.muted }]}>Pay terms are set by the AJ office. Past work keeps the terms in force on its work date.</Text>
        </Card>

        <SectionTitle icon="badge">Personal details</SectionTitle>
        <Card>
          <Row label="Mobile" value={me.phone} />
          <Row label="Emergency contact" value={me.emergencyContact ?? "Not provided"} />
          <Row label="Licence no." value={me.licenseNumber ?? "Not provided"} />
          {me.licenseExpiry && <Row label="Licence expiry" value={dateLabel(me.licenseExpiry)} />}
          {me.joinedOn && <Row label="Joined" value={dateLabel(me.joinedOn)} />}
          <Text style={[type.bodySm, { color: color.muted }]}>To change these details, contact the AJ office. They are managed by an administrator.</Text>
        </Card>

        <View style={{ gap: space.sm }}>
          <LinkRow icon="account-balance-wallet" label="Earnings & salary history" href="/earnings" />
          <LinkRow icon="notifications-none" label="Notifications" href="/notifications" />
          <LinkRow icon="help-outline" label="Help & dispatch contacts" href="/help" />
        </View>

        <Btn variant="outline" icon="logout" label="Sign out" onPress={() => setConfirm(true)} />
      </Screen>

      <Dialog visible={confirm} onClose={() => setConfirm(false)} title="Sign out?">
        {activeJobs > 0 && (
          <Banner tone="warning" title={`You have ${activeJobs} job${activeJobs > 1 ? "s" : ""} in progress`} body="Signing out does not stop or save anything. You will still need to record the ending meter reading. Any unsent reading or photo on this screen will be discarded." />
        )}
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}><Btn variant="outline" label="Stay signed in" onPress={() => setConfirm(false)} /></View>
          <View style={{ flex: 1 }}>
            <Btn variant="danger" label="Sign out" loading={signingOut} onPress={async () => { setSigningOut(true); await signOut(); }} />
          </View>
        </View>
      </Dialog>
    </>
  );

  function LinkRow({ icon, label, href }: { icon: IconName; label: string; href: Href }) {
    return (
      <Pressable accessibilityRole="button" onPress={() => router.push(href)} style={{ flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: color.white, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space.md, minHeight: 56 }}>
        <Icon name={icon} />
        <Text style={[type.labelLg, { color: color.ink, flex: 1 }]}>{label}</Text>
        <Icon name="chevron-right" tint={color.muted} />
      </Pressable>
    );
  }
}
