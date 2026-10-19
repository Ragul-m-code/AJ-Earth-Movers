import { MaterialIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font } from "@/theme";

type IconName = ComponentProps<typeof MaterialIcons>["name"];

function TabIcon({ name, focused, side }: { name: IconName; focused: boolean; side: boolean }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <View
        style={
          side
            ? { position: "absolute", left: -18, width: 3, height: 24, borderRadius: 2, backgroundColor: focused ? color.accent : "transparent" }
            : { position: "absolute", top: -10, width: 28, height: 3, borderRadius: 2, backgroundColor: focused ? color.accent : "transparent" }
        }
      />
      <MaterialIcons name={name} size={24} color={focused ? color.navy : color.muted} />
    </View>
  );
}

// Five hubs per the Stitch admin IA: Home, Work, Fleet, Finance, More. On wide screens the bar becomes a left rail.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const side = width >= 1024;
  const icon = (name: IconName) => {
    const TabBarIcon = ({ focused }: { focused: boolean }) => <TabIcon name={name} focused={focused} side={side} />;
    return TabBarIcon;
  };
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: side ? "left" : "bottom",
        tabBarVariant: side ? "material" : "uikit",
        tabBarActiveTintColor: color.navy,
        tabBarInactiveTintColor: color.muted,
        tabBarLabelStyle: { fontFamily: font.bold, fontSize: 11 },
        tabBarStyle: side ? { width: 104, borderRightColor: color.border, backgroundColor: color.white } : { height: 60 + insets.bottom, paddingTop: 8, borderTopColor: color.border, backgroundColor: color.white },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("dashboard") }} />
      <Tabs.Screen name="work" options={{ title: "Work", tabBarIcon: icon("assignment") }} />
      <Tabs.Screen name="fleet" options={{ title: "Fleet", tabBarIcon: icon("construction") }} />
      <Tabs.Screen name="finance" options={{ title: "Finance", tabBarIcon: icon("receipt-long") }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: icon("apps") }} />
    </Tabs>
  );
}

