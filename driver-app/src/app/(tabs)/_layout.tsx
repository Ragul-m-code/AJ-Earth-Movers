import { MaterialIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font } from "@/theme";

type IconName = ComponentProps<typeof MaterialIcons>["name"];

// Bottom bar per the Stitch driver IA spec: 4 tabs, 60px bar, orange accent pill above the active tab.
function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ position: "absolute", top: -10, width: 28, height: 3, borderRadius: 2, backgroundColor: focused ? color.accent : "transparent" }} />
      <MaterialIcons name={name} size={24} color={focused ? color.navy : color.muted} />
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.navy,
        tabBarInactiveTintColor: color.muted,
        tabBarLabelStyle: { fontFamily: font.bold, fontSize: 11 },
        tabBarStyle: { height: 60 + insets.bottom, paddingTop: 8, borderTopColor: color.border, backgroundColor: color.white },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ focused }) => <TabIcon name="dashboard" focused={focused} /> }} />
      <Tabs.Screen name="work" options={{ title: "My Work", tabBarIcon: ({ focused }) => <TabIcon name="assignment" focused={focused} /> }} />
      <Tabs.Screen name="analytics" options={{ title: "Analytics", tabBarIcon: ({ focused }) => <TabIcon name="insert-chart-outlined" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ focused }) => <TabIcon name="person-outline" focused={focused} /> }} />
    </Tabs>
  );
}
