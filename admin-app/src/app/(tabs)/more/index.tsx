import { useState } from "react";
import { Text, View } from "react-native";
import { ConfirmDialog, Grid, ListRow } from "@/components/kit";
import { AppHeader, Badge, Btn, Card, Screen, SectionTitle, type IconName } from "@/components/ui";
import { useSession, type Module } from "@/lib/session";
import { color, radius, space, type } from "@/theme";

const SECTIONS: { title: string; items: { icon: IconName; title: string; subtitle: string; href: string; module?: Module; alsoFor?: Module }[] }[] = [
  {
    title: "People",
    items: [
      { icon: "groups", title: "Customers", subtitle: "Profiles, sites, agreed rates and ledger", href: "/more/customers", module: "CUSTOMERS" },
      { icon: "badge", title: "Drivers", subtitle: "Operators, accounts, pay terms and work history", href: "/more/drivers", module: "DRIVERS", alsoFor: "PAYROLL" },
      { icon: "admin-panel-settings", title: "Users & roles", subtitle: "Staff accounts and module permissions", href: "/more/users", module: "USERS" },
    ],
  },
  {
    title: "Insight",
    items: [
      { icon: "insert-chart-outlined", title: "Reports", subtitle: "Hours, utilization, billing, outstanding, driver earnings, CSV export", href: "/more/reports", module: "REPORTS" },
      { icon: "notifications-none", title: "Notifications", subtitle: "Meter submissions and alerts", href: "/more/notifications" },
    ],
  },
  {
    title: "Governance & business settings",
    items: [
      { icon: "account-balance", title: "Business profile & tax", subtitle: "Company details, GST rules and their verification", href: "/more/settings/tax", module: "SETTINGS" },
      { icon: "tune", title: "Operational settings", subtitle: "Meter thresholds and contact numbers", href: "/more/settings/app", module: "SETTINGS" },
      { icon: "history-edu", title: "Audit log", subtitle: "Who approved, changed, invoiced or paid, and when", href: "/more/audit", module: "SETTINGS" },
    ],
  },
];

/** Secondary navigation hub (Stitch: admin_more_hub_secondary_navigation). */
export default function MoreHub() {
  const { user, can, signOut } = useSession();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <AppHeader title="More" eyebrow="Operations hub" />
      <Screen>
        <Card accent={color.accent}>
          <View style={{ paddingLeft: 6, flexDirection: "row", alignItems: "center", gap: space.md }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: color.navy, alignItems: "center", justifyContent: "center" }}>
              <Text style={[type.headlineMd, { color: color.accent }]}>{user?.displayName.split(" ").map((p) => p[0]).slice(0, 2).join("")}</Text>
            </View>
            <View style={{ flex: 1, gap: 4, alignItems: "flex-start" }}>
              <Text style={[type.headlineSm, { color: color.ink }]}>{user?.displayName}</Text>
              <Text style={[type.bodySm, { color: color.muted }]}>{user?.email}</Text>
              <Badge label={user?.role === "OWNER" ? "Owner · full access" : user?.role === "MANAGER" ? "Manager" : "Accounts"} tone="info" />
            </View>
          </View>
        </Card>
        {SECTIONS.map((s) => {
          const items = s.items.filter((i) => !i.module || can(i.module) || (i.alsoFor && can(i.alsoFor)));
          if (!items.length) return null;
          return (
            <View key={s.title} style={{ gap: space.sm }}>
              <SectionTitle>{s.title}</SectionTitle>
              <Grid max={2}>
                {items.map((i) => (
                  <ListRow key={i.href} icon={i.icon} title={i.title} subtitle={i.subtitle} href={i.href as never} />
                ))}
              </Grid>
            </View>
          );
        })}
        <ListRow icon="manage-accounts" title="My profile" subtitle="Your details and password" href={"/more/profile" as never} />
        <View style={{ backgroundColor: color.dangerBg, borderRadius: radius.lg, padding: space.xs }}>
          <Btn variant="ghost" icon="logout" label="Sign out" onPress={() => setConfirm(true)} />
        </View>
      </Screen>
      <ConfirmDialog visible={confirm} title="Sign out?" confirmLabel="Sign out" danger onCancel={() => setConfirm(false)} onConfirm={signOut} />
    </>
  );
}
