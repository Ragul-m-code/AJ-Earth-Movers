import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Banner, Btn, ConnectionPill, Field, Icon, Logo, useOffline } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { color, font, radius, space, type } from "@/theme";

export default function Login() {
  const insets = useSafeAreaInsets();
  const { signIn, expiredNotice } = useSession();
  const offline = useOffline();
  const [loginId, setLoginId] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ id?: string; pin?: string; form?: string }>({});

  const submit = async () => {
    const next: typeof errors = {};
    if (!loginId.trim()) next.id = "Enter your driver ID, e.g. DRV-104.";
    if (!/^\d{4,6}$/.test(pin)) next.pin = "PIN must be 4 to 6 digits.";
    setErrors(next);
    if (next.id || next.pin) return;
    setBusy(true);
    try {
      await signIn(loginId.trim(), pin);
    } catch (e) {
      setPin("");
      setErrors({ form: e instanceof ApiError ? e.message : "Sign-in failed. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.canvas, paddingTop: insets.top }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.gutter, paddingTop: space.md, gap: space.lg, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <ConnectionPill />
          <View style={{ backgroundColor: color.accentSoft, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={[type.labelSm, { color: color.warningText }]}>Driver app</Text>
          </View>
        </View>

        <View style={{ alignItems: "center", gap: space.md, marginTop: space.lg }}>
          <Logo size={56} />
          <View style={{ backgroundColor: color.navy, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 6, flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Icon name="badge" size={16} tint={color.accent} />
            <Text style={[type.labelSm, { color: color.white }]}>Operator sign-in</Text>
          </View>
          <Text style={[type.displaySm, { color: color.ink }]}>Shift Sign-In</Text>
          <Text style={[type.bodyMd, { color: color.muted, textAlign: "center" }]}>Sign in to see the machines and jobs assigned to you.</Text>
        </View>

        {expiredNotice && <Banner tone="warning" title="You were signed out" body="Your session ended. Sign in again to continue." />}
        {offline && <Banner tone="danger" title="No internet connection" body="Signing in needs mobile data or Wi-Fi." />}
        {errors.form && <Banner tone="danger" title="Couldn't sign in" body={errors.form} />}

        <View style={{ backgroundColor: color.white, borderWidth: 1, borderColor: color.border, borderRadius: radius.xl, padding: space.lg, gap: space.lg }}>
          <Field
            label="Driver ID"
            required
            value={loginId}
            onChangeText={(t) => setLoginId(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="e.g. DRV-104"
            error={errors.id}
            returnKeyType="next"
            textContentType="username"
          />
          <View>
            <Field
              label="Security PIN"
              required
              value={pin}
              onChangeText={(t) => setPin(t.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry={!showPin}
              placeholder="4–6 digits"
              error={errors.pin}
              onSubmitEditing={submit}
              textContentType="password"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPin ? "Hide PIN" : "Show PIN"}
              onPress={() => setShowPin((s) => !s)}
              style={{ position: "absolute", right: 4, top: 22, width: 44, height: 48, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name={showPin ? "visibility-off" : "visibility"} tint={color.muted} />
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: space.sm, backgroundColor: color.recessed, padding: space.md, borderRadius: radius.lg }}>
            <Icon name="verified-user" size={18} tint={color.muted} />
            <Text style={[type.bodySm, { color: color.muted, flex: 1 }]}>You can only view and submit readings for jobs assigned to you.</Text>
          </View>
          <Btn label="Sign in" icon="login" variant="accent" onPress={submit} loading={busy} disabled={offline} />
        </View>

        <Text style={[type.bodySm, { color: color.muted, textAlign: "center" }]}>
          Forgot your PIN or need your account activated? Contact AJ dispatch. Your PIN is reset by an administrator.
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={[type.labelSm, { color: color.muted, textAlign: "center", fontFamily: font.semibold }]}>AJ Earth Movers · Fleet Management</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
