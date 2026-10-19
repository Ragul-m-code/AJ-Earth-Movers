import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from "@expo-google-fonts/inter";
import { Stack, useRouter, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { Btn, StatusScreen } from "@/components/ui";
import { SessionProvider, useSession } from "@/lib/session";
import { color } from "@/theme";

function RootStack() {
  const { status } = useSession();
  if (status === "loading") return <StatusScreen busy title="AJ Driver" body="Starting…" />;
  const signedIn = status === "signedIn";
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }}>
      {/* Client-side guard for navigation only; the server enforces every permission. */}
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="job/[id]/index" />
        <Stack.Screen name="job/[id]/vehicle" />
        <Stack.Screen name="job/[id]/reading" />
        <Stack.Screen name="job/[id]/camera" options={{ presentation: "fullScreenModal", animation: "fade" }} />
        <Stack.Screen name="job/[id]/review" />
        <Stack.Screen name="job/[id]/submitted" options={{ gestureEnabled: false }} />
        <Stack.Screen name="earnings" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="help" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.canvas }}>
        <ActivityIndicator size="large" color={color.navy} />
      </View>
    );
  }
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <RootStack />
    </SessionProvider>
  );
}

/** Last-resort crash screen: an unexpected error in any screen lands here instead of a blank app. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <CrashScreen retry={retry} />;
}

function CrashScreen({ retry }: { retry: () => void }) {
  const router = useRouter();
  return (
    <StatusScreen icon="report-problem" title="Something went wrong" body="The app hit an unexpected problem. Nothing was submitted from this screen. Try again, or go back to home.">
      <Btn variant="accent" icon="refresh" label="Try again" onPress={retry} />
      <Btn variant="outline" icon="home" label="Go to home" onPress={() => router.replace("/")} />
    </StatusScreen>
  );
}
