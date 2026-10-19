import { Image } from "expo-image";
import { Text, View } from "react-native";
import type { PhotoCapture } from "@/lib/drafts";
import { timeLabel } from "@/lib/format";
import { color, radius, space, type } from "@/theme";
import { Badge, Btn, Card, Icon, SectionTitle } from "./ui";

export function PhotoProof({ photo, onTake, onRemove, disabled, title }: {
  photo: PhotoCapture | null;
  onTake: () => void;
  onRemove: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <>
      <SectionTitle icon="photo-camera" right={<Badge label="Required" tone={photo ? "success" : "danger"} />}>{title}</SectionTitle>
      <Card>
        <Text style={[type.bodySm, { color: color.muted }]}>
          Take a clear, straight photo of the hour meter. All digits, including the decimal, must be readable without glare.
        </Text>
        {photo ? (
          <>
            <View>
              <Image source={{ uri: photo.uri }} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md }} contentFit="cover" accessibilityLabel="Captured meter photo" />
              <View style={{ position: "absolute", left: 8, bottom: 8, backgroundColor: "rgba(15,23,42,0.75)", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={[type.labelMd, { color: color.white }]}>Taken {timeLabel(photo.capturedAt)}</Text>
              </View>
            </View>
            <Text style={[type.bodySm, { color: color.muted }]}>Check the photo: can you read every digit? If not, retake it.</Text>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Btn compact variant="outline" icon="replay" label="Retake" onPress={onTake} disabled={disabled} />
              </View>
              <View style={{ flex: 1 }}>
                <Btn compact variant="ghost" icon="delete-outline" label="Remove" onPress={onRemove} disabled={disabled} />
              </View>
            </View>
          </>
        ) : (
          <View style={{ borderWidth: 1.5, borderStyle: "dashed", borderColor: color.borderStrong, borderRadius: radius.lg, padding: space.lg, alignItems: "center", gap: space.sm }}>
            <Icon name="add-a-photo" size={36} tint={color.muted} />
            <Btn variant="dark" icon="photo-camera" label="Open camera" onPress={onTake} disabled={disabled} />
          </View>
        )}
      </Card>
    </>
  );
}
