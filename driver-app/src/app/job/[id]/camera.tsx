import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Btn, Icon, LoadingView } from "@/components/ui";
import { updateDraft, type PhotoCapture } from "@/lib/drafts";
import type { MeterKind } from "@/lib/types";
import { color, radius, space, type } from "@/theme";

/** Longest edge kept for meter photos: digits stay sharp and uploads stay well under the 4 MB server limit. */
const MAX_EDGE = 1600;

async function shrink(pic: { uri: string; width: number; height: number }) {
  if (Math.max(pic.width, pic.height) <= MAX_EDGE) return pic;
  try {
    const context = ImageManipulator.manipulate(pic.uri);
    context.resize(pic.width >= pic.height ? { width: MAX_EDGE, height: null } : { width: null, height: MAX_EDGE });
    const image = await context.renderAsync();
    const out = await image.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    return { uri: out.uri, width: out.width, height: out.height };
  } catch {
    return pic;
  }
}

export default function MeterCamera() {
  const { id, kind: kindParam } = useLocalSearchParams<{ id: string; kind: MeterKind }>();
  const kind: MeterKind = kindParam === "END" ? "END" : "START";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [shot, setShot] = useState<PhotoCapture | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace(`/job/${id}/reading?kind=${kind}`));

  if (!permission) return <LoadingView label="Opening camera…" />;
  if (!permission.granted) {
    return (
      <View style={[styles.dark, { paddingTop: insets.top + space.xl, padding: space.lg, gap: space.lg, justifyContent: "center" }]}>
        <Icon name="no-photography" size={48} tint={color.accent} />
        <Text style={[type.headlineLg, { color: color.white }]}>Camera access needed</Text>
        <Text style={[type.bodyLg, { color: "#CBD5E1" }]}>
          A photo of the hour meter is required for every reading. AJ Driver uses the camera only for these photos.
        </Text>
        {permission.canAskAgain ? (
          <Btn variant="accent" label="Allow camera" icon="photo-camera" onPress={requestPermission} />
        ) : (
          <Btn variant="accent" label="Open phone settings" icon="settings" onPress={() => Linking.openSettings()} />
        )}
        <Btn variant="outline" label="Cancel" onPress={close} />
      </View>
    );
  }

  const capture = async () => {
    if (!camera.current || !ready) return;
    setCapturing(true);
    setError(null);
    try {
      const pic = await shrink(await camera.current.takePictureAsync({ quality: 0.7, exif: false }));
      setShot({ uri: pic.uri, width: pic.width, height: pic.height, capturedAt: new Date().toISOString() });
    } catch {
      setError("The photo could not be taken. Hold the phone steady and try again.");
    } finally {
      setCapturing(false);
    }
  };

  const usePhoto = () => {
    if (!shot) return;
    updateDraft(id, kind, { photo: shot });
    close();
  };

  if (shot) {
    return (
      <View style={[styles.dark, { paddingTop: insets.top + space.sm }]}>
        <Text style={[type.headlineMd, { color: color.white, paddingHorizontal: space.gutter }]}>Check the photo</Text>
        <Image source={{ uri: shot.uri }} style={{ flex: 1, margin: space.gutter, borderRadius: radius.xl }} contentFit="contain" accessibilityLabel="Captured meter photo" />
        <View style={{ padding: space.gutter, paddingBottom: insets.bottom + space.md, gap: space.sm }}>
          <Text style={[type.bodyMd, { color: "#CBD5E1" }]}>Are all digits, including the decimal, sharp and free of glare?</Text>
          <Btn variant="accent" icon="check" label="Use this photo" onPress={usePhoto} />
          <Btn variant="outline" icon="replay" label="Retake" onPress={() => setShot(null)} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.dark}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} onCameraReady={() => setReady(true)} onMountError={() => setError("The camera could not start. Close and try again.")} />
      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close camera" onPress={close} style={styles.roundBtn}>
          <Icon name="close" tint={color.white} />
        </Pressable>
        <Text style={[type.labelLg, { color: color.white }]}>{kind === "START" ? "Starting" : "Ending"} meter photo</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={torch ? "Turn torch off" : "Turn torch on"} onPress={() => setTorch((t) => !t)} style={styles.roundBtn}>
          <Icon name={torch ? "flashlight-on" : "flashlight-off"} tint={torch ? color.accent : color.white} />
        </Pressable>
      </View>

      <View style={styles.frameWrap} pointerEvents="none">
        <View style={styles.frame}>
          <View style={styles.frameLabel}>
            <Text style={[type.labelSm, { color: color.accent }]}>Align hour meter here</Text>
          </View>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        {error ? <Text style={[type.bodyMd, { color: "#FCA5A5", textAlign: "center" }]}>{error}</Text> : null}
        <Text style={[type.bodyMd, { color: color.white, textAlign: "center" }]}>Hold 20–30 cm from the dial. Avoid sun glare and shadows.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take meter photo"
          disabled={!ready || capturing}
          onPress={capture}
          style={({ pressed }) => [styles.shutter, (!ready || capturing) && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.95 }] }]}
        >
          <View style={styles.shutterInner}>
            <Icon name="photo-camera" size={32} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dark: { flex: 1, backgroundColor: color.navyDeep },
  topBar: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.gutter, paddingBottom: space.sm, backgroundColor: "rgba(0,0,0,0.45)" },
  roundBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  frameWrap: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  frame: { width: "80%", aspectRatio: 4 / 3, borderWidth: 3, borderColor: color.accent, borderRadius: radius.xl, alignItems: "center" },
  frameLabel: { marginTop: -12, backgroundColor: "rgba(0,0,0,0.75)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", gap: space.md, paddingTop: space.md, paddingHorizontal: space.gutter, backgroundColor: "rgba(0,0,0,0.5)" },
  shutter: { width: 84, height: 84, borderRadius: 42, backgroundColor: color.accent, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 68, height: 68, borderRadius: 34, backgroundColor: color.white, alignItems: "center", justifyContent: "center" },
});
