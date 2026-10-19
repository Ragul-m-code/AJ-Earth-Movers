import { MaterialIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useNetworkState } from "expo-network";
import { useRouter } from "expo-router";
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ApiError } from "@/lib/api";
import { color, font, radius, space, touch, type } from "@/theme";

export type IconName = ComponentProps<typeof MaterialIcons>["name"];
export type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const TONES: Record<Tone, { bg: string; fg: string; dot: string }> = {
  info: { bg: color.infoBg, fg: color.infoText, dot: color.info },
  success: { bg: color.successBg, fg: color.successText, dot: color.success },
  warning: { bg: color.warningBg, fg: color.warningText, dot: color.warning },
  danger: { bg: color.dangerBg, fg: color.dangerText, dot: color.danger },
  neutral: { bg: color.recessed, fg: color.muted, dot: color.muted },
};

export function Icon({ name, size = 22, tint = color.navy }: { name: IconName; size?: number; tint?: string }) {
  return <MaterialIcons name={name} size={size} color={tint} />;
}

/** AJ Earth Movers Control lockup (brand spec "Control" variant): mark, wordmark and navy CONTROL badge. */
export function Logo({ size = 32, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }} accessibilityLabel="AJ Earth Movers Control">
      <Image source={require("../../assets/admin-mark.png")} style={{ width: size, height: size, borderRadius: size * 0.2 }} contentFit="contain" />
      {withText && (
        <View style={{ gap: 3 }}>
          <Text style={{ fontFamily: font.extrabold, fontSize: size * 0.36, color: color.navy, letterSpacing: -0.4 }}>AJ Earth Movers</Text>
          <View style={{ alignSelf: "flex-start", backgroundColor: color.navy, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ fontFamily: font.extrabold, fontSize: 10, color: color.white, letterSpacing: 2 }}>CONTROL</Text>
          </View>
        </View>
      )}
    </View>
  );
}

export function ConnectionPill() {
  const net = useNetworkState();
  // isInternetReachable can be null while unknown; only report offline when the OS says so.
  const offline = net.isConnected === false || net.isInternetReachable === false;
  return (
    <View
      accessibilityLabel={offline ? "No internet connection" : "Online"}
      style={[styles.pill, { backgroundColor: offline ? color.dangerBg : color.recessed }]}
    >
      <View style={[styles.dot, { backgroundColor: offline ? color.danger : color.success }]} />
      <Text style={[type.labelSm, { color: offline ? color.dangerText : color.navy }]}>{offline ? "Offline" : "Online"}</Text>
    </View>
  );
}

export function useOffline() {
  const net = useNetworkState();
  return net.isConnected === false || net.isInternetReachable === false;
}

export function AppHeader({ title, eyebrow, back, right }: { title: string; eyebrow?: string; back?: boolean; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flex: 1, minWidth: 0 }}>
        {back ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={styles.iconBtn}>
            <Icon name="arrow-back" />
          </Pressable>
        ) : (
          <Logo size={34} withText={false} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          {eyebrow ? <Text style={[type.labelSm, { color: color.muted }]} numberOfLines={1}>{eyebrow}</Text> : null}
          <Text style={[type.headlineSm, { color: color.ink, fontFamily: font.bold }]} numberOfLines={1}>{title}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <ConnectionPill />
        {right}
      </View>
    </View>
  );
}

export function OfflineBanner() {
  const offline = useOffline();
  if (!offline) return null;
  return (
    <View style={styles.offline} accessibilityLiveRegion="polite">
      <Icon name="cloud-off" tint={color.white} size={20} />
      <View style={{ flex: 1 }}>
        <Text style={[type.labelLg, { color: color.white }]}>No internet connection</Text>
        <Text style={[type.bodySm, { color: color.white }]}>Changes cannot be saved until the connection returns.</Text>
      </View>
    </View>
  );
}

export function Screen({ children, onRefresh, refreshing = false, footer, padded = true }: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  footer?: ReactNode;
  padded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.canvas }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={[padded && { padding: space.gutter }, { gap: space.md, paddingBottom: footer ? space.lg : insets.bottom + space.xl, width: "100%", maxWidth: 1100, alignSelf: "center" }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.navy} /> : undefined}
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
          <View style={{ width: "100%", maxWidth: 1100, alignSelf: "center", gap: space.sm }}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}

export function Card({ children, accent, style, padded = true }: { children: ReactNode; accent?: string; style?: ViewStyle; padded?: boolean }) {
  return (
    <View style={[styles.card, padded && { padding: space.md }, style]}>
      {accent ? <View style={[styles.accent, { backgroundColor: accent }]} /> : null}
      {children}
    </View>
  );
}

export function SectionTitle({ children, right, icon }: { children: ReactNode; right?: ReactNode; icon?: IconName }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon ? <Icon name={icon} size={20} /> : null}
        <Text style={[type.headlineSm, { color: color.ink, fontFamily: font.bold }]} accessibilityRole="header">{children}</Text>
      </View>
      {right}
    </View>
  );
}

type BtnVariant = "accent" | "dark" | "outline" | "ghost" | "danger";
export function Btn({ label, onPress, variant = "dark", icon, disabled, loading, sub, compact }: {
  label: string;
  onPress: () => void;
  variant?: BtnVariant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  sub?: string;
  compact?: boolean;
}) {
  const v = {
    accent: { bg: color.accent, fg: color.navy, border: color.accent },
    dark: { bg: color.navy, fg: color.white, border: color.navy },
    outline: { bg: color.white, fg: color.navy, border: color.navy },
    ghost: { bg: "transparent", fg: color.muted, border: "transparent" },
    danger: { bg: "#B91C1C", fg: color.white, border: "#B91C1C" },
  }[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: v.bg, borderColor: v.border, minHeight: compact ? 44 : sub ? 64 : touch.min, opacity: inactive ? 0.5 : 1 },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : icon ? <Icon name={icon} tint={v.fg} size={20} /> : null}
      <View style={{ alignItems: "center", flexShrink: 1 }}>
        <Text style={[type.labelLg, { color: v.fg, fontFamily: font.bold, fontSize: compact ? 14 : 15, textAlign: "center" }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{label}</Text>
        {sub ? <Text style={[type.labelMd, { color: v.fg, opacity: 0.85, textAlign: "center", fontFamily: font.medium }]}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

export function Badge({ label, tone }: { label: string; tone: Tone }) {
  const t = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <View style={[styles.dot, { backgroundColor: t.dot }]} />
      <Text style={[type.labelSm, { color: t.fg, flexShrink: 1 }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function Banner({ tone, title, body, icon, action }: { tone: Tone; title: string; body?: string; icon?: IconName; action?: ReactNode }) {
  const t = TONES[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg, borderColor: t.dot }]} accessibilityRole={tone === "danger" ? "alert" : undefined}>
      <Icon name={icon ?? (tone === "danger" ? "error-outline" : tone === "warning" ? "warning-amber" : tone === "success" ? "check-circle-outline" : "info-outline")} tint={t.fg} size={20} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.labelLg, { color: t.fg }]}>{title}</Text>
        {body ? <Text style={[type.bodySm, { color: t.fg }]}>{body}</Text> : null}
        {action ? <View style={{ marginTop: space.sm }}>{action}</View> : null}
      </View>
    </View>
  );
}

export function Metric({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: string; tone?: Tone }) {
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Text style={[type.labelSm, { color: tone ? TONES[tone].fg : color.muted }]}>{label}</Text>
      <Text style={[type.metric, { color: color.ink }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {unit ? <Text style={[type.labelMd, { color: color.muted }]}> {unit}</Text> : null}
      </Text>
      {sub ? <Text style={[type.bodySm, { color: color.muted }]}>{sub}</Text> : null}
    </View>
  );
}

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingVertical: 4 }}>
      <Text style={[type.bodyMd, { color: color.muted, flexShrink: 1 }]}>{label}</Text>
      <Text style={[strong ? type.labelLg : type.bodyMd, { color: color.ink, textAlign: "right", flexShrink: 1, fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  );
}

export function Field({ label, error, hint, required, ...input }: TextInputProps & { label: string; error?: string | null; hint?: string; required?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.labelSm, { color: color.navy }]}>
        {label}
        {required ? <Text style={{ color: color.danger }}> *</Text> : null}
      </Text>
      <TextInput
        placeholderTextColor={color.placeholder}
        accessibilityLabel={label}
        {...input}
        style={[styles.input, error ? { borderColor: color.danger } : null, input.multiline && { minHeight: 88, textAlignVertical: "top", paddingTop: 12 }]}
      />
      {error ? <Text style={[type.bodySm, { color: color.dangerText }]} accessibilityLiveRegion="polite">{error}</Text> : hint ? <Text style={[type.bodySm, { color: color.muted }]}>{hint}</Text> : null}
    </View>
  );
}

export function LoadingView({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={color.navy} />
      <Text style={[type.bodyMd, { color: color.muted }]}>{label}</Text>
    </View>
  );
}

/** Full-screen message used for start-up, 404, crash and connection states. */
export function StatusScreen({ icon, title, body, children, busy }: { icon?: IconName; title: string; body?: string; children?: ReactNode; busy?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.statusScreen, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}>
      <View style={{ alignItems: "center", gap: space.md, width: "100%", maxWidth: 420 }}>
        <Logo size={56} withText={false} />
        {busy ? <ActivityIndicator size="large" color={color.navy} /> : icon ? <Icon name={icon} size={44} tint={color.muted} /> : null}
        <Text style={[type.headlineMd, { color: color.ink, textAlign: "center" }]} accessibilityRole="header">{title}</Text>
        {body ? <Text style={[type.bodyMd, { color: color.muted, textAlign: "center" }]}>{body}</Text> : null}
        {children ? <View style={{ alignSelf: "stretch", gap: space.sm, marginTop: space.sm }}>{children}</View> : null}
      </View>
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const offline = useOffline();
  const network = error.kind === "network";
  // Reload by itself when the connection comes back.
  const wasOffline = useRef(offline);
  useEffect(() => {
    if (wasOffline.current && !offline) onRetry();
    wasOffline.current = offline;
  }, [offline, onRetry]);
  const title = offline ? "You're offline" : network ? "Can't reach the server" : "Couldn't load this";
  const body = offline
    ? "Connect to mobile data or Wi-Fi. This screen reloads by itself when you're back online."
    : network
      ? "The AJ server did not respond. Check your connection and try again."
      : error.message;
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <Icon name={offline ? "wifi-off" : network ? "cloud-off" : "error-outline"} size={40} tint={color.muted} />
      <Text style={[type.headlineSm, { color: color.ink, textAlign: "center" }]}>{title}</Text>
      <Text style={[type.bodyMd, { color: color.muted, textAlign: "center" }]}>{body}</Text>
      <View style={{ alignSelf: "stretch" }}>
        <Btn label="Try again" icon="refresh" onPress={onRetry} variant="outline" disabled={offline} />
      </View>
    </View>
  );
}

export function EmptyView({ icon, title, body }: { icon: IconName; title: string; body?: string }) {
  return (
    <View style={[styles.center, { paddingVertical: space.xl }]}>
      <Icon name={icon} size={40} tint={color.borderStrong} />
      <Text style={[type.headlineSm, { color: color.ink, textAlign: "center" }]}>{title}</Text>
      {body ? <Text style={[type.bodyMd, { color: color.muted, textAlign: "center" }]}>{body}</Text> : null}
    </View>
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.chip, selected && { backgroundColor: color.navy, borderColor: color.navy }]}
          >
            <Text style={[type.labelLg, { color: selected ? color.white : color.navy }]}>
              {o.label}
              {o.count !== undefined ? ` (${o.count})` : ""}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Dialog({ visible, title, body, children, onClose }: { visible: boolean; title: string; body?: string; children: ReactNode; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.dialog} accessibilityViewIsModal>
          <Text style={[type.headlineMd, { color: color.ink }]} accessibilityRole="header">{title}</Text>
          {body ? <Text style={[type.bodyMd, { color: color.muted }]}>{body}</Text> : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: color.white,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    paddingHorizontal: space.gutter,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  iconBtn: { width: 44, height: 44, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: color.recessed },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingHorizontal: 10, borderRadius: radius.full, alignSelf: "flex-start" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  offline: { flexDirection: "row", gap: space.sm, alignItems: "center", backgroundColor: "#B91C1C", paddingHorizontal: space.gutter, paddingVertical: 10 },
  footer: { backgroundColor: color.white, borderTopWidth: 1, borderTopColor: color.border, paddingHorizontal: space.gutter, paddingTop: space.md, gap: space.sm },
  card: { backgroundColor: color.white, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, overflow: "hidden", gap: space.sm },
  accent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  btn: { flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, borderWidth: 1.5, paddingHorizontal: space.lg, paddingVertical: 10 },
  banner: { flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.lg, borderLeftWidth: 4 },
  input: {
    minHeight: touch.min,
    borderWidth: 1.5,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    backgroundColor: color.white,
    fontFamily: font.medium,
    fontSize: 16,
    color: color.ink,
  },
  center: { alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl, flexGrow: 1 },
  statusScreen: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.gutter, backgroundColor: color.canvas },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: color.white, justifyContent: "center" },
  scrim: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  dialog: { backgroundColor: color.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: space.xl, gap: space.md },
});
