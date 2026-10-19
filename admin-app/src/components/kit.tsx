import { useRouter, type Href } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api";
import { dateLabel, todayIst } from "@/lib/format";
import { color, font, radius, space, touch, type } from "@/theme";
import { Badge, Banner, Btn, Field, Icon, type IconName, type Tone } from "./ui";

/** Columns for responsive grids: 1 on phones, 2 on tablets, 3+ on desktop browsers. */
export function useColumns(max = 3) {
  const { width } = useWindowDimensions();
  return Math.max(1, Math.min(max, width >= 1280 ? 3 : width >= 760 ? 2 : 1));
}

export function Grid({ children, max = 3, gap = space.md }: { children: ReactNode; max?: number; gap?: number }) {
  const cols = useColumns(max);
  const items = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>
      {items.map((c, i) => (
        <View key={i} style={{ width: cols === 1 ? "100%" : `${100 / cols - 1.5}%`, flexGrow: 1 }}>
          {c}
        </View>
      ))}
    </View>
  );
}

export function Kpi({ label, value, sub, tone, icon, onPress }: { label: string; value: string; sub?: string; tone?: Tone; icon?: IconName; onPress?: () => void }) {
  const fg = tone === "danger" ? color.dangerText : tone === "warning" ? color.warningText : tone === "success" ? color.successText : color.ink;
  const bg = tone === "danger" ? color.dangerBg : tone === "warning" ? color.warningBg : tone === "success" ? color.successBg : color.white;
  return (
    <Pressable disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? "button" : undefined} style={[styles.kpi, { backgroundColor: bg }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={[type.labelSm, { color: tone ? fg : color.muted }]}>{label}</Text>
        {icon ? <Icon name={icon} size={18} tint={fg} /> : null}
      </View>
      <Text style={[type.metric, { color: fg, fontSize: 24 }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={[type.bodySm, { color: color.muted }]}>{sub}</Text> : null}
    </Pressable>
  );
}

export function ListRow({ title, subtitle, meta, right, onPress, href, icon, accent }: {
  title: string;
  subtitle?: string;
  meta?: string;
  right?: ReactNode;
  onPress?: () => void;
  href?: Href;
  icon?: IconName;
  accent?: string;
}) {
  const router = useRouter();
  const press = onPress ?? (href ? () => router.push(href) : undefined);
  return (
    <Pressable onPress={press} disabled={!press} accessibilityRole={press ? "button" : undefined} style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.recessed }]}>
      {accent ? <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: accent }} /> : null}
      {icon ? (
        <View style={styles.rowIcon}>
          <Icon name={icon} size={20} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[type.labelLg, { color: color.ink }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[type.bodySm, { color: color.muted }]} numberOfLines={2}>{subtitle}</Text> : null}
        {meta ? <Text style={[type.labelMd, { color: color.navy }]}>{meta}</Text> : null}
      </View>
      {right}
      {press ? <Icon name="chevron-right" tint={color.muted} /> : null}
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: sel }} style={[styles.segItem, sel && { backgroundColor: color.navy }]}>
            <Text style={[type.labelLg, { color: sel ? color.white : color.navy, textAlign: "center" }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {o.label}
              {o.count !== undefined ? ` (${o.count})` : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder: string }) {
  return (
    <View style={styles.search}>
      <Icon name="search" tint={color.muted} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={color.placeholder} accessibilityLabel={placeholder} autoCorrect={false} style={styles.searchInput} />
      {value ? (
        <Pressable onPress={() => onChange("")} accessibilityLabel="Clear search" hitSlop={10}>
          <Icon name="close" tint={color.muted} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Debounced copy of a value, for search boxes. */
export function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface Option {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** Tap-to-open picker with search, accessible on phones and the web. */
export function Select({ label, value, options, onChange, placeholder = "Select…", error, required, searchable }: {
  label: string;
  value: string | null;
  options: Option[];
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  required?: boolean;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const insets = useSafeAreaInsets();
  const current = options.find((o) => o.value === value);
  const shown = q ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.labelSm, { color: color.navy }]}>
        {label}
        {required ? <Text style={{ color: color.danger }}> *</Text> : null}
      </Text>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? "not selected"}`} style={[styles.select, error ? { borderColor: color.danger } : null]}>
        <View style={{ flex: 1 }}>
          <Text style={[type.bodyLg, { color: current ? color.ink : color.placeholder }]} numberOfLines={1}>{current?.label ?? placeholder}</Text>
          {current?.hint ? <Text style={[type.bodySm, { color: color.muted }]} numberOfLines={1}>{current.hint}</Text> : null}
        </View>
        <Icon name="expand-more" tint={color.muted} />
      </Pressable>
      {error ? <Text style={[type.bodySm, { color: color.dangerText }]}>{error}</Text> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.scrim}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={[type.headlineMd, { color: color.ink }]}>{label}</Text>
              <Pressable onPress={() => setOpen(false)} accessibilityLabel="Close" hitSlop={10}>
                <Icon name="close" />
              </Pressable>
            </View>
            {searchable || options.length > 8 ? <SearchBar value={q} onChange={setQ} placeholder={`Search ${label.toLowerCase()}`} /> : null}
            <FlatList
              data={shown}
              keyExtractor={(o) => o.value}
              style={{ maxHeight: 420 }}
              ListEmptyComponent={<Text style={[type.bodyMd, { color: color.muted, padding: space.md }]}>No matches.</Text>}
              renderItem={({ item }) => (
                <Pressable
                  disabled={item.disabled}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                    setQ("");
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.value === value, disabled: item.disabled }}
                  style={[styles.option, item.value === value && { backgroundColor: color.accentSoft }, item.disabled && { opacity: 0.45 }]}
                >
                  <Text style={[type.labelLg, { color: color.ink }]}>{item.label}</Text>
                  {item.hint ? <Text style={[type.bodySm, { color: color.muted }]}>{item.hint}</Text> : null}
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const shiftDays = (ymd: string, d: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

/** Date entry as YYYY-MM-DD with quick picks; validated as a real calendar date. */
export function DateInput({ label, value, onChange, error, required, quick = true }: { label: string; value: string; onChange: (v: string) => void; error?: string | null; required?: boolean; quick?: boolean }) {
  const today = todayIst();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  return (
    <View style={{ gap: 6 }}>
      <Field label={label} required={required} value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" autoCapitalize="none" maxLength={10} error={error ?? (value && !valid ? "Use the format YYYY-MM-DD, e.g. 2026-10-18." : null)} hint={valid ? dateLabel(value) : undefined} />
      {quick ? (
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          {[
            ["Today", today],
            ["Tomorrow", shiftDays(today, 1)],
            ["Yesterday", shiftDays(today, -1)],
          ].map(([l, d]) => (
            <Pressable key={l} onPress={() => onChange(d!)} style={styles.quick} accessibilityRole="button">
              <Text style={[type.labelMd, { color: color.navy }]}>{l}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const isValidDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString?.().slice(0, 10) === v;
export const isMoney = (v: string) => /^\d{1,10}(\.\d{1,2})?$/.test(v.trim());

export function MoneyInput(props: { label: string; value: string; onChange: (v: string) => void; required?: boolean; error?: string | null; hint?: string }) {
  return (
    <Field
      label={`${props.label} (₹)`}
      required={props.required}
      value={props.value}
      onChangeText={(t) => props.onChange(t.replace(/[^\d.]/g, ""))}
      keyboardType="decimal-pad"
      placeholder="0.00"
      error={props.error ?? (props.value && !isMoney(props.value) ? "Enter an amount like 1850 or 1850.50." : null)}
      hint={props.hint}
    />
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: touch.min }}>
      <View style={{ flex: 1 }}>
        <Text style={[type.labelLg, { color: color.ink }]}>{label}</Text>
        {hint ? <Text style={[type.bodySm, { color: color.muted }]}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: color.accent, false: color.borderStrong }} thumbColor={color.white} />
    </View>
  );
}

export function FormSection({ step, title, children, right }: { step?: string; title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        {step ? (
          <View style={styles.step}>
            <Text style={{ fontFamily: font.extrabold, color: color.white, fontSize: 12 }}>{step}</Text>
          </View>
        ) : null}
        <Text style={[type.headlineSm, { color: color.ink, fontFamily: font.bold, flex: 1 }]} accessibilityRole="header">{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

/** Confirmation for consequential actions. When `reasonLabel` is set, a reason of `minReason` characters is required. */
export function ConfirmDialog({ visible, title, body, confirmLabel, danger, reasonLabel, minReason = 5, onCancel, onConfirm, children }: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  reasonLabel?: string;
  minReason?: number;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const reset = () => {
    setReason("");
    setErr(null);
  };
  const cancel = () => {
    reset();
    onCancel();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.scrim}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
          <Text style={[type.headlineMd, { color: color.ink }]} accessibilityRole="header">{title}</Text>
          {body ? <Text style={[type.bodyMd, { color: color.muted }]}>{body}</Text> : null}
          {children}
          {reasonLabel ? <Field label={reasonLabel} required value={reason} onChangeText={setReason} multiline maxLength={500} /> : null}
          {err ? <Banner tone="danger" title="Not done" body={err} /> : null}
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Btn variant="outline" label="Cancel" onPress={cancel} disabled={busy} />
            </View>
            <View style={{ flex: 1 }}>
              <Btn
                variant={danger ? "danger" : "accent"}
                label={confirmLabel}
                loading={busy}
                disabled={!!reasonLabel && reason.trim().length < minReason}
                onPress={async () => {
                  setBusy(true);
                  setErr(null);
                  try {
                    await onConfirm(reason.trim());
                    reset();
                  } catch (e) {
                    setErr(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong.");
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Short-lived success/error message shown at the top of a screen. */
export function useFlash() {
  const [flash, setFlash] = useState<{ tone: Tone; title: string; body?: string } | null>(null);
  useEffect(() => {
    if (!flash || flash.tone === "danger") return;
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, [flash]);
  const node = flash ? <Banner tone={flash.tone} title={flash.title} body={flash.body} /> : null;
  return {
    node,
    ok: (title: string, body?: string) => setFlash({ tone: "success", title, body }),
    fail: (e: unknown, title = "Not saved") => setFlash({ tone: "danger", title, body: e instanceof ApiError ? e.message : "Something went wrong. Try again." }),
    clear: () => setFlash(null),
  };
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  ASSIGNED: { label: "Assigned", tone: "info" },
  ACCEPTED: { label: "Accepted", tone: "info" },
  DECLINED: { label: "Declined", tone: "danger" },
  IN_PROGRESS: { label: "Working", tone: "success" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "warning" },
  CORRECTION_REQUIRED: { label: "Correction needed", tone: "danger" },
  APPROVED: { label: "Approved", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  AVAILABLE: { label: "Available", tone: "success" },
  WORKING: { label: "Working", tone: "info" },
  MAINTENANCE: { label: "Maintenance", tone: "warning" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "success" },
  ON_LEAVE: { label: "On leave", tone: "warning" },
  DISABLED: { label: "Deactivated", tone: "neutral" },
  DRAFT: { label: "Draft", tone: "neutral" },
  ISSUED: { label: "Issued", tone: "info" },
  PARTIALLY_PAID: { label: "Part paid", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  PENDING: { label: "Pending", tone: "warning" },
  VOID: { label: "Void", tone: "neutral" },
  VERIFIED: { label: "Verified", tone: "success" },
  UNVERIFIED: { label: "Not verified", tone: "danger" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "neutral" as Tone };
  return <Badge label={s.label} tone={s.tone} />;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.md }}>
      <Btn compact variant="outline" label="Previous" onPress={() => onPage(page - 1)} disabled={page <= 1} />
      <Text style={[type.labelLg, { color: color.navy }]}>
        Page {page} of {pages}
      </Text>
      <Btn compact variant="outline" label="Next" onPress={() => onPage(page + 1)} disabled={page >= pages} />
    </View>
  );
}

export function InfoGrid({ items, style }: { items: [string, string | null | undefined][]; style?: ViewStyle }) {
  return (
    <View style={[{ flexDirection: "row", flexWrap: "wrap", gap: space.md }, style]}>
      {items.map(([k, v]) => (
        <View key={k} style={{ minWidth: 140, flexGrow: 1, flexBasis: "40%", gap: 2 }}>
          <Text style={[type.labelSm, { color: color.muted }]}>{k}</Text>
          <Text style={[type.bodyMd, { color: color.ink, fontFamily: font.semibold }]}>{v || "—"}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  kpi: { borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space.md, gap: 4, minHeight: 96 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: color.white, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space.md, minHeight: 64, overflow: "hidden" },
  rowIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.recessed, alignItems: "center", justifyContent: "center" },
  segment: { flexDirection: "row", backgroundColor: color.recessed, borderRadius: radius.lg, padding: 4, gap: 4 },
  segItem: { flex: 1, minHeight: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  search: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: color.white, borderWidth: 1.5, borderColor: color.borderStrong, borderRadius: radius.md, paddingHorizontal: 12 },
  searchInput: { flex: 1, minWidth: 0, height: 48, fontFamily: font.medium, fontSize: 15, color: color.ink },
  select: { minHeight: touch.min, borderWidth: 1.5, borderColor: color.borderStrong, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: color.white, flexDirection: "row", alignItems: "center", gap: space.sm },
  scrim: { flex: 1, backgroundColor: "rgba(12,29,48,0.6)", justifyContent: "flex-end", alignItems: "center" },
  sheet: { width: "100%", maxWidth: 640, backgroundColor: color.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, gap: space.md },
  option: { paddingVertical: 12, paddingHorizontal: space.md, borderRadius: radius.md, gap: 2 },
  quick: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: color.white },
  section: { backgroundColor: color.white, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space.md, gap: space.md },
  step: { width: 26, height: 26, borderRadius: 6, backgroundColor: color.navy, alignItems: "center", justifyContent: "center" },
});
