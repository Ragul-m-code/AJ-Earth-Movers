import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { AppHeader, Banner, Btn, Card, Icon, Screen, SectionTitle } from "@/components/ui";
import { api, API_URL } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { color, font, radius, space, type } from "@/theme";

const TOPICS = [
  { title: "Accepting or declining a job", body: "Open the job from My Work. Tap Accept to confirm. To decline, give a short reason so dispatch can reassign it." },
  { title: "Taking the meter photo", body: "Hold the phone 20–30 cm from the hour meter, straight on. Every digit and the decimal must be sharp. Avoid sun glare; use the torch in a dark cab. Retake if any digit is unclear." },
  { title: "Entering meter readings", body: "Type exactly what the meter shows, with one decimal (e.g. 1259.5). Operating hours = ending reading − starting reading. If the app warns about a reading, check the digits before you submit." },
  { title: "Checking approval status", body: "After submitting, the job shows Pending approval. An admin compares your readings with the photos. Approved hours count for pay. If rejected, you will see the reason and can resubmit." },
  { title: "When an upload fails", body: "Readings need an internet connection and are not stored offline. If you see “Not submitted”, nothing was saved: check your data and try again. If you see “Not confirmed yet”, tap Retry. It is safe and will not create a duplicate." },
  { title: "How pay is calculated", body: "Pay = approved hours × your hourly rate on each work date, plus authorized additions, minus authorized deductions. Working days are the dates with approved work, however many jobs were on a date." },
];

export default function Help() {
  const support = useLoad(() => api.support());
  const [open, setOpen] = useState<number | null>(null);
  const [ping, setPing] = useState<"idle" | "checking" | "ok" | "fail">("idle");
  const s = support.data;

  const testConnection = async () => {
    setPing("checking");
    try {
      const r = await fetch(`${API_URL}/api/health`);
      setPing(r.ok ? "ok" : "fail");
    } catch {
      setPing("fail");
    }
  };

  const call = (n: string) => Linking.openURL(`tel:${n.replace(/\s/g, "")}`);

  return (
    <>
      <AppHeader back title="Help & support" />
      <Screen>
        <Banner tone="warning" icon="wifi" title="Internet required" body="Starting and ending readings and photos can only be submitted online. Nothing is saved on the phone if the connection drops." />

        <SectionTitle icon="menu-book">Guides</SectionTitle>
        {TOPICS.map((t, i) => (
          <Pressable key={t.title} onPress={() => setOpen(open === i ? null : i)} accessibilityRole="button" accessibilityState={{ expanded: open === i }} style={{ backgroundColor: color.white, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space.md, gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text style={[type.labelLg, { color: color.ink, flex: 1 }]}>{t.title}</Text>
              <Icon name={open === i ? "expand-less" : "expand-more"} tint={color.muted} />
            </View>
            {open === i && <Text style={[type.bodyMd, { color: color.navy }]}>{t.body}</Text>}
          </Pressable>
        ))}

        <SectionTitle icon="support-agent">Contacts</SectionTitle>
        <Card>
          <ContactRow label="Dispatch desk" number={s?.dispatchPhone} onCall={call} />
          <ContactRow label="Payroll queries" number={s?.payrollPhone} onCall={call} />
          <ContactRow label="Emergency (national)" number={s?.emergencyPhone} onCall={call} danger />
          {support.error && <Text style={[type.bodySm, { color: color.dangerText }]}>Could not load contacts: {support.error.message}</Text>}
        </Card>

        <SectionTitle icon="network-check">Connection test</SectionTitle>
        <Card>
          <Text style={[type.bodySm, { color: color.muted }]}>Checks whether this phone can reach the AJ server right now.</Text>
          <Btn variant="outline" icon="network-ping" label="Test connection" onPress={testConnection} loading={ping === "checking"} />
          {ping === "ok" && <Banner tone="success" title="Server reachable" body="You can submit readings." />}
          {ping === "fail" && <Banner tone="danger" title="Server not reachable" body="Check mobile data or move to an area with better signal." />}
        </Card>
      </Screen>
    </>
  );
}

function ContactRow({ label, number, onCall, danger }: { label: string; number: string | null | undefined; onCall: (n: string) => void; danger?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 6 }}>
      <View style={{ flex: 1 }}>
        <Text style={[type.labelLg, { color: color.ink }]}>{label}</Text>
        <Text style={[type.bodySm, { color: number ? color.navy : color.muted, fontFamily: font.medium }]}>{number ?? "Not configured by the office yet"}</Text>
      </View>
      {number ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Call ${label}`} onPress={() => onCall(number)} style={{ width: 48, height: 48, borderRadius: radius.lg, backgroundColor: danger ? "#B91C1C" : color.navy, alignItems: "center", justifyContent: "center" }}>
          <Icon name="call" tint={color.white} />
        </Pressable>
      ) : null}
    </View>
  );
}
