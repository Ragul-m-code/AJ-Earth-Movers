import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Banner, Btn, ConnectionPill, Field, Icon, Logo, useOffline } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { color, radius, space, type } from "@/theme";

export default function Login() {
  const insets = useSafeAreaInsets();
  const { signIn, notice } = useSession();
  const offline = useOffline();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ id?: string; pw?: string; form?: string }>({});

  const submit = async () => {
    const next: typeof errors = {};
    if (identifier.trim().length < 3) next.id = "Enter your work email or mobile number.";
    if (!password) next.pw = "Enter your password.";
    setErrors(next);
    if (next.id || next.pw) return;
    setBusy(true);
    try {
      await signIn(identifier.trim(), password);
    } catch (e) {
      setPassword("");
      setErrors({ form: e instanceof ApiError ? e.message : "Sign-in failed. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.canvas, paddingTop: insets.top }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.gutter, paddingTop: space.md, gap: space.lg, flexGrow: 1, width: "100%", maxWidth: 520, alignSelf: "center" }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <ConnectionPill />
          <View style={{ backgroundColor: color.recessed, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3, flexDirection: "row", gap: 4, alignItems: "center" }}>
            <Icon name="lock" size={14} tint={color.navy} />
            <Text style={[type.labelSm, { color: color.navy }]}>Secure sign-in</Text>
          </View>
        </View>

        <View style={{ alignItems: "center", gap: space.md, marginTop: space.lg }}>
          <Logo size={64} />
          <Text style={[type.labelSm, { color: color.accentText }]}>Fleet intelligence & oversight</Text>
          <Text style={[type.displaySm, { color: color.ink }]}>Welcome back</Text>
          <Text style={[type.bodyMd, { color: color.muted, textAlign: "center" }]}>Sign in to manage your fleet and operations.</Text>
        </View>

        {notice && <Banner tone="warning" title="Signed out" body={notice} />}
        {offline && <Banner tone="danger" title="No internet connection" body="Signing in needs an internet connection." />}
        {errors.form && <Banner tone="danger" title="Couldn't sign in" body={errors.form} />}

        <View style={{ backgroundColor: color.white, borderWidth: 1, borderColor: color.border, borderRadius: radius.xl, padding: space.lg, gap: space.lg }}>
          <Field label="Work email or mobile number" required value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" placeholder="name@company.in" error={errors.id} />
          <View>
            <Field label="Password" required value={password} onChangeText={setPassword} secureTextEntry={!show} textContentType="password" onSubmitEditing={submit} error={errors.pw} />
            <Pressable accessibilityRole="button" accessibilityLabel={show ? "Hide password" : "Show password"} onPress={() => setShow((s) => !s)} style={{ position: "absolute", right: 4, top: 22, width: 44, height: 48, alignItems: "center", justifyContent: "center" }}>
              <Icon name={show ? "visibility-off" : "visibility"} tint={color.muted} />
            </Pressable>
          </View>
          <Btn label="Sign in" icon="login" variant="accent" onPress={submit} loading={busy} disabled={offline} />
        </View>

        <View style={{ flexDirection: "row", gap: space.sm, backgroundColor: color.recessed, padding: space.md, borderRadius: radius.lg }}>
          <Icon name="admin-panel-settings" size={20} tint={color.navy} />
          <Text style={[type.bodySm, { color: color.navy, flex: 1 }]}>
            Self-registration is disabled. The owner creates staff accounts and can reset a forgotten password from Users & Roles.
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={[type.labelSm, { color: color.muted, textAlign: "center" }]}>Authorized personnel only</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
