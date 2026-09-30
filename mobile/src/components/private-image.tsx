import { Image, type ImageStyle } from "expo-image";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { mediaUrl } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { face } from "../lib/tokens";

/**
 * Photo frame from globals.css `.photo-frame`: contain, cream ground,
 * no corner radius (timeline cards are edge to edge).
 */
export function PrivateImage({
  path,
  width,
  height,
  label,
  headers,
  frameWidth,
}: Readonly<{
  path: string;
  width?: number;
  height?: number;
  label: string;
  headers?: Record<string, string> | null;
  frameWidth: number;
}>) {
  const { colors } = useAppTheme();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Intentional reset when the source changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFailed(false);
  }, [path, headers]);

  const ratio = width && height && height > 0 ? width / height : 4 / 3;
  const maxHeight = Math.min(frameWidth * (16 / 9), 852 * 0.9);
  const frameHeight = Math.min(maxHeight, frameWidth / ratio);

  if (failed || !headers) {
    return (
      <View
        style={[
          styles.frame,
          { height: frameHeight, backgroundColor: colors.cream },
        ]}
      >
        <Text style={[styles.fallback, face(colors, 400, "record"), { color: colors.muted }]}>
          {headers === undefined && !failed ? "Loading" : `${label} unavailable`}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.frame, { height: frameHeight, backgroundColor: colors.cream }]}>
      <Image
        source={{ uri: mediaUrl(path), headers }}
        style={styles.image as ImageStyle}
        contentFit="contain"
        cachePolicy="none"
        accessibilityLabel={label}
        onError={() => setFailed(true)}
      />
      <View pointerEvents="none" style={styles.scrim} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 48,
    backgroundColor: "rgba(4, 10, 7, 0.22)",
  },
  fallback: {
    fontSize: 11,
    textAlign: "center",
    paddingHorizontal: 16,
  },
});
