import { useState } from "react";
import { Text } from "react-native";
import { FormSection, InfoGrid, useFlash } from "@/components/kit";
import { PasswordForm } from "@/components/PasswordForm";
import { AppHeader, Btn, Card, Screen, SectionTitle } from "@/components/ui";
import { useSession } from "@/lib/session";
import { color, type } from "@/theme";

/** Own account details and password change (Stitch: admin_profile_settings, admin_reset_password). */
export default function Profile() {
  const { user, signOut } = useSession();
  const flash = useFlash();
  const [showPw, setShowPw] = useState(false);
  return (
    <>
      <AppHeader back title="My profile" eyebrow="Account" />
      <Screen>
        {flash.node}
        <Card>
          <InfoGrid items={[["Name", user?.displayName], ["Email (sign-in)", user?.email], ["Mobile", user?.phone], ["Role", user?.role === "OWNER" ? "Owner" : user?.role === "MANAGER" ? "Manager" : "Accounts"]]} />
          <Text style={[type.bodySm, { color: color.muted }]}>The owner manages names, roles and permissions in Users & roles.</Text>
        </Card>
        <SectionTitle icon="verified-user">Permissions</SectionTitle>
        <Card><Text style={[type.bodyMd, { color: color.ink }]}>{user?.permissions.map((p) => p.toLowerCase().replace(/_/g, " ")).join(", ")}</Text></Card>
        {showPw ? (
          <FormSection title="Change password">
            <PasswordForm onDone={() => { setShowPw(false); flash.ok("Password changed", "Other devices were signed out."); }} />
          </FormSection>
        ) : (
          <Btn variant="outline" icon="lock-reset" label="Change password" onPress={() => setShowPw(true)} />
        )}
        <Btn variant="ghost" icon="logout" label="Sign out" onPress={signOut} />
      </Screen>
    </>
  );
}
