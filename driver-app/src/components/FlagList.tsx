import { View } from "react-native";
import { flagText } from "@/lib/meterRules";
import { space } from "@/theme";
import { Banner } from "./ui";

export function FlagList({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <View style={{ gap: space.sm }}>
      {flags.map((f) => {
        const t = flagText(f);
        return <Banner key={f} tone="warning" title={t.title} body={`${t.help} An admin will review this.`} />;
      })}
    </View>
  );
}
