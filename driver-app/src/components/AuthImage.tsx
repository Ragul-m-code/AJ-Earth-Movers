import { Image, type ImageStyle } from "expo-image";
import { useState } from "react";
import { Text, View } from "react-native";
import { API_URL, authHeaders } from "@/lib/api";
import { color } from "@/theme";

/** Private meter photo. Native sends the session header with the image request. */
export function AuthImage({ path, style, label }: { path: string; style: ImageStyle; label: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={[style, { alignItems: "center", justifyContent: "center", backgroundColor: color.recessed }]} accessibilityLabel={`${label} unavailable`}>
        <Text style={{ color: color.muted }}>Photo unavailable</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: `${API_URL}${path}`, headers: authHeaders() }}
      cachePolicy="none"
      style={[style, { backgroundColor: color.recessed }]}
      contentFit="cover"
      onError={() => setFailed(true)}
      accessible
      accessibilityLabel={label}
    />
  );
}
