import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { dateLabel, hours, meter } from "@/lib/format";
import { FLAG_TEXT, type WorkOrderItem } from "@/lib/types";
import { color, font, radius, space, type } from "@/theme";
import { StatusBadge } from "./kit";
import { Btn, Card, Icon } from "./ui";

export function WorkOrderCard({ w }: { w: WorkOrderItem }) {
  const router = useRouter();
  return (
    <Card padded={false}>
      <View style={{ padding: space.md, gap: space.sm }}>
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
          <View style={{ backgroundColor: color.navy, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: color.white, fontFamily: font.bold, fontSize: 12 }}>{w.code}</Text>
          </View>
          <Text style={[type.labelLg, { color: color.ink, flex: 1 }]} numberOfLines={1}>{w.customer.name}</Text>
          <StatusBadge status={w.status} />
        </View>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Icon name="place" size={16} tint={color.muted} />
          <Text style={[type.bodySm, { color: color.navy, flex: 1 }]} numberOfLines={1}>{w.siteName}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <MiniBox label="Machine" value={`${w.vehicle.make} ${w.vehicle.model} (${w.vehicle.unitCode})`} icon="construction" />
          <MiniBox label="Operator" value={`${w.driver.fullName} (${w.driver.driverCode})`} icon="person" />
        </View>
        {w.flags.length > 0 && <Text style={[type.labelMd, { color: color.warningText }]}>⚠ {w.flags.length} flag(s): {FLAG_TEXT[w.flags[0]!] ?? w.flags[0]}</Text>}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
          <Text style={[type.bodySm, { color: color.muted }]}>
            {dateLabel(w.workDate)}
            {w.operatingHours ? ` · ${hours(w.operatingHours)}` : w.start ? ` · started at ${meter(w.start.value)}` : ""}
          </Text>
          {w.status === "PENDING_APPROVAL" ? (
            <Btn compact variant="accent" label="Review" icon="fact-check" onPress={() => router.push(`/work/review/${w.id}`)} />
          ) : (
            <Btn compact variant="ghost" label="Details" onPress={() => router.push(`/work/${w.id}`)} />
          )}
        </View>
      </View>
    </Card>
  );
}

function MiniBox({ label, value, icon }: { label: string; value: string; icon: "construction" | "person" }) {
  return (
    <View style={{ flex: 1, backgroundColor: color.recessed, borderRadius: radius.md, padding: 8, flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
      <Icon name={icon} size={18} tint={color.muted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.labelSm, { color: color.muted }]}>{label}</Text>
        <Text style={[type.labelMd, { color: color.ink }]} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}
