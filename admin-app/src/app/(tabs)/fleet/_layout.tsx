import { Stack } from "expo-router";
import { color } from "@/theme";

export default function FleetStack() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }} />;
}
