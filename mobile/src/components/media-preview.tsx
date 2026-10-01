import { useEffect, useState, type ReactNode } from "react";
import { requireOptionalNativeModule } from "expo";
import { Image, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { formatMediaDuration, type PickedMedia } from "../lib/pick-media";
import { useAppTheme } from "../lib/theme";
import { face } from "../lib/tokens";

type Playback = {
  pause: () => void;
};

type VideoModule = {
  useVideoPlayer: (source: { uri: string }, setup?: (player: Playback) => void) => Playback;
  VideoView: (props: {
    player: Playback;
    style?: object;
    contentFit?: "cover";
    nativeControls?: boolean;
  }) => ReactNode;
};

let cachedModule: Promise<VideoModule | null> | null = null;

function loadVideoModule() {
  if (!cachedModule) {
    cachedModule = (async () => {
      if (!requireOptionalNativeModule("ExpoVideo")) return null;
      return import("expo-video") as unknown as Promise<VideoModule>;
    })().catch(() => null);
  }
  return cachedModule;
}

function PausedFrame({
  uri,
  useVideoPlayer,
  VideoView,
}: Readonly<{
  uri: string;
  useVideoPlayer: VideoModule["useVideoPlayer"];
  VideoView: VideoModule["VideoView"];
}>) {
  const player = useVideoPlayer({ uri }, (video) => {
    video.pause();
  });
  return (
    <VideoView
      player={player}
      contentFit="cover"
      nativeControls={false}
      style={StyleSheet.absoluteFill}
    />
  );
}

function VideoFrame({ uri }: Readonly<{ uri: string }>) {
  const [module, setModule] = useState<VideoModule | null>(null);
  useEffect(() => {
    let active = true;
    void loadVideoModule().then((loaded) => {
      if (active) setModule(loaded);
    });
    return () => {
      active = false;
    };
  }, []);
  if (!module) return null;
  return <PausedFrame uri={uri} useVideoPlayer={module.useVideoPlayer} VideoView={module.VideoView} />;
}

/** The picked photo, or a video's first frame, filling the tile. */
export function MediaStill({ item }: Readonly<{ item: PickedMedia }>) {
  const { colors } = useAppTheme();
  const still = item.kind === "photo" ? item.previewUri : item.posterUri;
  const duration = item.kind === "video" ? formatMediaDuration(item.durationMs) : null;
  return (
    <View style={styles.fill}>
      {still ? (
        <Image source={{ uri: still }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <VideoFrame uri={item.previewUri} />
      )}
      {item.kind === "video" ? (
        <View style={styles.videoChrome} pointerEvents="none">
          <View style={styles.play}>
            <Ionicons name="play" size={14} color="#fff" style={{ marginLeft: 1 }} />
          </View>
          {duration ? (
            <Text style={[face(colors, 600), styles.duration]}>{duration}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#101216" },
  videoChrome: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  play: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  duration: {
    position: "absolute",
    left: 8,
    bottom: 8,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    color: "#fff",
    fontSize: 11,
    lineHeight: 14,
  },
});
