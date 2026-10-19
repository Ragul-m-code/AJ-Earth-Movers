import { useState } from "react";
import { Text, View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { color, space, type } from "@/theme";
import { Banner, Btn, Field } from "./ui";

/** Shown after sign-in with a temporary password, and reused from Profile settings. */
export function PasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rules = [
    { ok: next.length >= 10, text: "At least 10 characters" },
    { ok: /[A-Za-z]/.test(next) && /\d/.test(next), text: "Letters and numbers" },
    { ok: next.length > 0 && next === confirm, text: "Both entries match" },
  ];
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      {error && <Banner tone="danger" title="Not changed" body={error} />}
      <Field label="Current or temporary password" required value={current} onChangeText={setCurrent} secureTextEntry textContentType="password" />
      <Field label="New password" required value={next} onChangeText={setNext} secureTextEntry textContentType="newPassword" />
      <Field label="Confirm new password" required value={confirm} onChangeText={setConfirm} secureTextEntry textContentType="newPassword" />
      <View style={{ gap: 4 }}>
        {rules.map((r) => (
          <Text key={r.text} style={[type.bodySm, { color: r.ok ? color.successText : color.muted }]}>
            {r.ok ? "✓" : "•"} {r.text}
          </Text>
        ))}
      </View>
      <Btn variant="accent" icon="lock-reset" label="Save new password" onPress={save} loading={busy} disabled={!current || !rules.every((r) => r.ok)} />
      <Text style={[type.bodySm, { color: color.muted }]}>Changing your password signs you out on every other device.</Text>
    </View>
  );
}
