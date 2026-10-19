import { useRouter } from "expo-router";
import { Btn, StatusScreen } from "@/components/ui";

/** Unmatched routes, e.g. an old link or a mistyped address. */
export default function NotFound() {
  const router = useRouter();
  return (
    <StatusScreen icon="travel-explore" title="Page not found" body="This page doesn't exist or has moved. Nothing was changed.">
      <Btn variant="accent" icon="home" label="Go to home" onPress={() => router.replace("/")} />
      {router.canGoBack() ? <Btn variant="outline" icon="arrow-back" label="Go back" onPress={() => router.back()} /> : null}
    </StatusScreen>
  );
}
