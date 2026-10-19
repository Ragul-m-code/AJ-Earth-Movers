import { useState } from "react";
import { Text, View } from "react-native";
import { ConfirmDialog, Grid, SearchBar, Segmented, StatusBadge, Toggle, useFlash } from "@/components/kit";
import { AppHeader, Badge, Banner, Btn, Card, Chips, EmptyView, ErrorView, Field, LoadingView, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { timeLabel } from "@/lib/format";
import { useSession, type Module } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";
import { color, space, type } from "@/theme";

interface AdminUserRow { id: string; displayName: string; email: string | null; phone: string | null; role: "OWNER" | "MANAGER" | "ACCOUNTS"; status: string; mustChangePassword: boolean; lastSeenAt: string | null; permissions: Module[]; isSelf: boolean }

const MODULES: { m: Module; label: string; sensitive?: boolean }[] = [
  { m: "DASHBOARD", label: "Dashboard" },
  { m: "WORK_ORDERS", label: "Work orders & dispatch" },
  { m: "METER_APPROVAL", label: "Meter approval" },
  { m: "METER_CORRECTION", label: "Meter corrections (rollover/replacement)", sensitive: true },
  { m: "FLEET", label: "Fleet & attachments" },
  { m: "MAINTENANCE", label: "Maintenance" },
  { m: "CUSTOMERS", label: "Customers" },
  { m: "RATES", label: "Rates (machine, breaker, customer)", sensitive: true },
  { m: "INVOICES", label: "Invoices", sensitive: true },
  { m: "PAYMENTS", label: "Payments", sensitive: true },
  { m: "DRIVERS", label: "Drivers" },
  { m: "PAYROLL", label: "Payroll & driver pay", sensitive: true },
  { m: "EXPENSES", label: "Expenses" },
  { m: "REPORTS", label: "Reports" },
  { m: "SETTINGS", label: "Business settings & audit log", sensitive: true },
  { m: "TAX_VERIFY", label: "Verify tax settings", sensitive: true },
];
const DEFAULTS: Record<"MANAGER" | "ACCOUNTS", Module[]> = {
  MANAGER: ["DASHBOARD", "WORK_ORDERS", "METER_APPROVAL", "FLEET", "MAINTENANCE", "CUSTOMERS", "DRIVERS", "EXPENSES", "REPORTS"],
  ACCOUNTS: ["DASHBOARD", "WORK_ORDERS", "METER_APPROVAL", "CUSTOMERS", "RATES", "INVOICES", "PAYMENTS", "PAYROLL", "EXPENSES", "REPORTS"],
};

/** Staff accounts and permissions; owner only (Stitch: admin_user_role_management). */
export default function Users() {
  const { user } = useSession();
  const flash = useFlash();
  const q = useLoad(() => api.get<AdminUserRow[]>("/users"));
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<AdminUserRow | "new" | null>(null);
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [statusFor, setStatusFor] = useState<AdminUserRow | null>(null);
  const [resetFor, setResetFor] = useState<AdminUserRow | null>(null);

  if (user?.role !== "OWNER") return <><AppHeader back title="Users & roles" /><Screen><Banner tone="danger" title="Owner only" body="Only the owner can manage staff accounts." /></Screen></>;
  const header = <AppHeader back title="Users & roles" eyebrow="Staff access" />;
  if (q.loading) return <>{header}<LoadingView /></>;
  if (!q.data) return <>{header}<ErrorView error={q.error!} onRetry={q.reload} /></>;
  const users = q.data.filter((u) => (filter === "all" || u.role === filter) && `${u.displayName} ${u.email} ${u.phone}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      {header}
      <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
        {flash.node}
        {secret && <Banner tone="success" title={`Temporary password for ${secret.who}: ${secret.password}`} body="Share it privately. It is shown only once, and they must set their own password at first sign-in." action={<Btn compact variant="outline" label="Done" onPress={() => setSecret(null)} />} />}
        <Btn variant="accent" icon="person-add" label="Add staff user" onPress={() => setEdit("new")} />
        <SearchBar value={search} onChange={setSearch} placeholder="Search name, email or phone" />
        <Chips value={filter} onChange={setFilter} options={[{ value: "all", label: "All", count: q.data.length }, { value: "OWNER", label: "Owner" }, { value: "MANAGER", label: "Managers" }, { value: "ACCOUNTS", label: "Accounts" }]} />
        {users.length === 0 ? (
          <EmptyView icon="group" title="No users match" />
        ) : (
          <Grid max={2}>
            {users.map((u) => (
              <Card key={u.id} accent={u.status === "ACTIVE" ? (u.role === "OWNER" ? color.accent : color.info) : color.borderStrong}>
                <View style={{ paddingLeft: 6, gap: space.sm }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                    <Text style={[type.headlineSm, { color: color.ink, flex: 1 }]}>{u.displayName}{u.isSelf ? " (you)" : ""}</Text>
                    <Badge label={u.role === "OWNER" ? "Owner" : u.role === "MANAGER" ? "Manager" : "Accounts"} tone={u.role === "OWNER" ? "warning" : "info"} />
                  </View>
                  <Text style={[type.bodySm, { color: color.muted }]}>{u.email}{u.phone ? ` · ${u.phone}` : ""}</Text>
                  <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                    <StatusBadge status={u.status} />
                    {u.mustChangePassword && <Badge label="Awaiting first sign-in" tone="warning" />}
                  </View>
                  <Text style={[type.bodySm, { color: color.muted }]}>{u.lastSeenAt ? `Last active ${timeLabel(u.lastSeenAt)}` : "No active session"}</Text>
                  {u.role !== "OWNER" && <Text style={[type.bodySm, { color: color.navy }]}>Modules: {u.permissions.map((p) => MODULES.find((x) => x.m === p)?.label ?? p).join(", ") || "none"}</Text>}
                  {!u.isSelf && (
                    <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                      {u.role !== "OWNER" && <Btn compact variant="outline" icon="tune" label="Permissions" onPress={() => setEdit(u)} />}
                      <Btn compact variant="outline" icon="lock-reset" label="Reset password" onPress={() => setResetFor(u)} />
                      <Btn compact variant={u.status === "ACTIVE" ? "ghost" : "dark"} label={u.status === "ACTIVE" ? "Deactivate" : "Reactivate"} onPress={() => setStatusFor(u)} />
                    </View>
                  )}
                </View>
              </Card>
            ))}
          </Grid>
        )}
      </Screen>
      {edit && <UserDialog user={edit === "new" ? null : edit} onClose={() => setEdit(null)} onCreated={(who, password) => { setSecret({ who, password }); }} onSaved={async () => { setEdit(null); flash.ok("Saved"); await q.refresh(); }} />}
      <ConfirmDialog visible={!!statusFor} title={statusFor?.status === "ACTIVE" ? `Deactivate ${statusFor?.displayName}?` : `Reactivate ${statusFor?.displayName}?`} body={statusFor?.status === "ACTIVE" ? "They are signed out immediately and cannot sign in." : undefined} confirmLabel="Confirm" danger={statusFor?.status === "ACTIVE"} reasonLabel="Reason" minReason={3} onCancel={() => setStatusFor(null)} onConfirm={async (reason) => { await api.post(`/users/${statusFor!.id}/status`, { active: statusFor!.status !== "ACTIVE", reason }); setStatusFor(null); flash.ok("Account updated"); await q.refresh(); }} />
      <ConfirmDialog visible={!!resetFor} title={`Reset password for ${resetFor?.displayName}?`} body="A new temporary password is shown once. They are signed out everywhere." confirmLabel="Reset" onCancel={() => setResetFor(null)} onConfirm={async () => { const r = await api.post<{ temporaryPassword: string }>(`/users/${resetFor!.id}/reset-password`); setSecret({ who: resetFor!.displayName, password: r.temporaryPassword }); setResetFor(null); await q.refresh(); }} />
    </>
  );
}

function UserDialog({ user, onClose, onCreated, onSaved }: { user: AdminUserRow | null; onClose: () => void; onCreated: (who: string, password: string) => void; onSaved: () => void }) {
  const [name, setName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [role, setRole] = useState<"MANAGER" | "ACCOUNTS">(user && user.role !== "OWNER" ? user.role : "MANAGER");
  const [perms, setPerms] = useState<Module[]>(user ? user.permissions : DEFAULTS.MANAGER);
  return (
    <ConfirmDialog
      visible
      title={user ? `Permissions · ${user.displayName}` : "Add staff user"}
      body={user ? undefined : "They receive a one-time temporary password and must choose their own at first sign-in."}
      confirmLabel={user ? "Save" : "Create user"}
      onCancel={onClose}
      onConfirm={async () => {
        if (user) {
          await api.patch(`/users/${user.id}`, { role, permissions: perms });
        } else {
          if (name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a name and a valid email.");
          const r = await api.post<{ temporaryPassword: string }>("/users", { displayName: name.trim(), email: email.trim(), phone: phone || undefined, role, permissions: perms });
          onCreated(name.trim(), r.temporaryPassword);
        }
        onSaved();
      }}
    >
      {!user && (
        <>
          <Field label="Full name" required value={name} onChangeText={setName} />
          <Field label="Work email (sign-in ID)" required value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <Field label="Mobile (optional, can also sign in)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        </>
      )}
      <Segmented value={role} onChange={(r) => { setRole(r); if (!user) setPerms(DEFAULTS[r]); }} options={[{ value: "MANAGER", label: "Manager" }, { value: "ACCOUNTS", label: "Accounts" }]} />
      <View style={{ maxHeight: 320 }}>
        {MODULES.map((x) => (
          <Toggle key={x.m} label={x.label} hint={x.sensitive ? "Sensitive" : undefined} value={perms.includes(x.m)} onChange={(on) => setPerms((p) => (on ? [...p, x.m] : p.filter((m) => m !== x.m)))} />
        ))}
      </View>
    </ConfirmDialog>
  );
}
