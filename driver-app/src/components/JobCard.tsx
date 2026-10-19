import { useRouter, type Href } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { dateLabel, hours, meter, relativeDay, rupees } from "@/lib/format";
import { STATUS_META } from "@/lib/meterRules";
import type { WorkOrderSummary } from "@/lib/types";
import { color, font, radius, space, type } from "@/theme";
import { Badge, Btn, Card, Icon, type IconName } from "./ui";

const ACCENT: Record<string, string> = {
  info: color.info,
  success: color.success,
  warning: color.warning,
  danger: color.danger,
  neutral: color.borderStrong,
};

/** The one thing the driver should do next for a job, or null when nothing is expected of them. */
export function nextAction(wo: WorkOrderSummary): { label: string; href: Href; variant: "accent" | "dark" | "danger"; icon: IconName } | null {
  switch (wo.status) {
    case "ASSIGNED":
      return { label: "Review & respond", href: `/job/${wo.id}`, variant: "dark", icon: "assignment" };
    case "ACCEPTED":
      return { label: "Start work: record starting meter", href: `/job/${wo.id}/reading?kind=START`, variant: "accent", icon: "photo-camera" };
    case "IN_PROGRESS":
      return { label: "End work: record ending meter", href: `/job/${wo.id}/reading?kind=END`, variant: "accent", icon: "photo-camera" };
    case "CORRECTION_REQUIRED": {
      const kind = wo.correctionNeeded.start ? "START" : "END";
      return { label: `Correct ${kind === "START" ? "starting" : "ending"} reading`, href: `/job/${wo.id}/reading?kind=${kind}`, variant: "danger", icon: "edit" };
    }
    default:
      return null;
  }
}

export function JobCard({ wo }: { wo: WorkOrderSummary }) {
  const router = useRouter();
  const meta = STATUS_META[wo.status];
  const action = nextAction(wo);
  const rel = relativeDay(wo.workDate);

  return (
    <Card accent={ACCENT[meta.tone]} padded={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Job ${wo.code}, ${meta.label}, ${wo.vehicle.make} ${wo.vehicle.model} at ${wo.siteName}. Open details.`}
        onPress={() => router.push(`/job/${wo.id}`)}
        style={{ padding: space.md, paddingLeft: space.md + 6, gap: space.sm }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.headlineSm, { fontFamily: font.extrabold, color: color.ink }]}>{wo.code}</Text>
            <Text style={[type.bodySm, { color: color.muted }]}>
              {rel ? `${rel} · ` : ""}
              {dateLabel(wo.workDate)}
              {wo.shiftLabel ? ` · ${wo.shiftLabel}` : ""}
            </Text>
          </View>
          <Badge label={meta.label} tone={meta.tone} />
        </View>

        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center", backgroundColor: color.recessed, borderRadius: radius.md, padding: 10 }}>
          <Icon name="construction" size={24} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.labelLg, { color: color.ink }]} numberOfLines={1}>
              {wo.vehicle.make} {wo.vehicle.model}
            </Text>
            <Text style={[type.bodySm, { color: color.muted }]}>
              {wo.vehicle.unitCode} · {wo.vehicle.registrationNo}
            </Text>
          </View>
        </View>

        <InfoLine icon="place" text={`${wo.siteName} · ${wo.customer.name}`} />
        {wo.attachments.length > 0 && <InfoLine icon="handyman" text={wo.attachments.map((a) => a.name).join(", ")} />}

        {wo.start && (
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Mini label="Start" value={meter(wo.start.value)} />
            <Mini label="End" value={wo.end ? meter(wo.end.value) : "—"} />
            <Mini label="Hours" value={wo.operatingHours ? hours(wo.operatingHours) : "—"} />
          </View>
        )}

        {wo.status === "CORRECTION_REQUIRED" && wo.latestReview?.reason ? (
          <View style={{ backgroundColor: color.dangerBg, borderRadius: radius.md, padding: 10 }}>
            <Text style={[type.labelSm, { color: color.dangerText }]}>Admin remark</Text>
            <Text style={[type.bodySm, { color: color.dangerText }]}>“{wo.latestReview.reason}”</Text>
          </View>
        ) : null}
        {wo.status === "PENDING_APPROVAL" && (
          <Text style={[type.bodySm, { color: color.warningText }]}>Submitted. Hours count only after admin approval.</Text>
        )}
        {wo.status === "APPROVED" && wo.approved && (
          <Text style={[type.labelMd, { color: color.successText }]}>
            {hours(wo.approved.hours)} approved
            {wo.approved.compensationMethod === "HOURLY" ? ` · ${rupees(wo.approved.driverAmount)} ${wo.approved.inPayroll ? "in payroll" : "awaiting payroll"}` : " · monthly salary"}
          </Text>
        )}
      </Pressable>
      {action && (
        <View style={{ paddingHorizontal: space.md, paddingLeft: space.md + 6, paddingBottom: space.md }}>
          <Btn label={action.label} icon={action.icon} variant={action.variant} onPress={() => router.push(action.href)} />
        </View>
      )}
    </Card>
  );
}

function InfoLine({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
      <Icon name={icon} size={16} tint={color.muted} />
      <Text style={[type.bodySm, { color: color.navy, flex: 1 }]} numberOfLines={2}>{text}</Text>
    </View>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[type.labelSm, { color: color.muted }]}>{label}</Text>
      <Text style={[type.labelLg, { color: color.ink, fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  );
}
