import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PasswordForm } from "@/components/PasswordForm";
import { Banner, Btn, Logo } from "@/components/ui";
import { useSession } from "@/lib/session";
import { color, radius, space, type } from "@/theme";

export default function ChangePassword() {
  const insets = useSafeAreaInsets();
  const { refreshUser, signOut, user } = useSession();
  return (
    <ScrollView contentContainerStyle={{ padding: space.gutter, paddingTop: insets.top + space.lg, gap: space.lg, width: "100%", maxWidth: 520, alignSelf: "center" }} keyboardShouldPersistTaps="handled">
      <Logo size={48} />
      <Text style={[type.displaySm, { color: color.ink }]}>Set your password</Text>
      <Banner tone="info" title={`Welcome${user ? `, ${user.displayName}` : ""}`} body="You signed in with a temporary password. Choose your own password to continue." />
      <View style={{ backgroundColor: color.white, borderWidth: 1, borderColor: color.border, borderRadius: radius.xl, padding: space.lg }}>
        <PasswordForm onDone={refreshUser} />
      </View>
      <Btn variant="ghost" icon="logout" label="Sign out" onPress={signOut} />
    </ScrollView>
  );
}
