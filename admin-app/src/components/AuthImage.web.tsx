import { Image, type ImageStyle } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { API_URL, authHeaders } from "@/lib/api";
import { color } from "@/theme";

/** Web: browsers cannot attach auth headers to <img>, so the photo is fetched as a blob first. */
export function AuthImage({ path, style, label }: { path: string; style: ImageStyle; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetch(`${API_URL}${path}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (cancelled) return;
        url = URL.createObjectURL(b);
        setSrc(url);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  if (!src) {
    return (
      <View style={[style, { alignItems: "center", justifyContent: "center", backgroundColor: color.recessed }]}>
        {failed ? <Text style={{ color: color.muted }}>Photo unavailable</Text> : <ActivityIndicator />}
      </View>
    );
  }
  return <Image source={{ uri: src }} style={style} contentFit="cover" accessible accessibilityLabel={label} />;
}
