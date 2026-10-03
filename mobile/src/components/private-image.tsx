import { Image, type ImageStyle } from "expo-image";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { mediaMaxHeight } from "../lib/media-frame";
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
  frameWidth: _frameWidth,
  mat,
  frameHeight,
  onSize,
}: Readonly<{
  path: string;
  width?: number;
  height?: number;
  label: string;
  headers?: Record<string, string> | null;
  frameWidth: number;
  /** Video frames use #050b08. Photos use cream. */
  mat?: string;
  /** Album slides: a fixed frame height; the photo is contained inside it. */
  frameHeight?: number;
  /** Reports the loaded image's pixel size (album frames without stored sizes). */
  onSize?: (width: number, height: number) => void;
}>) {
  const { colors } = useAppTheme();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Intentional reset when the photo changes, not when the cookie object does.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFailed(false);
  }, [path]);

  const ground = mat ?? colors.cream;
  const imageWidth = width && width > 0 ? width : 4;
  const imageHeight = height && height > 0 ? height : 3;
  // Width is 100% of the card. Height comes from that width via aspectRatio,
  // the same way the web SVG sizer does. An explicit height from the window
  // width is taller whenever the frame is narrower than the window.
  const frameStyle =
    frameHeight != null
      ? { height: frameHeight, backgroundColor: ground }
      : {
          aspectRatio: imageWidth / imageHeight,
          maxHeight: mediaMaxHeight(viewportWidth, viewportHeight),
          backgroundColor: ground,
        };

  if (failed || !headers) {
    return (
      <View
        style={[
          styles.frame,
          frameStyle,
        ]}
      >
        <Text style={[styles.fallback, face(colors, 400, "record"), { color: colors.muted }]}>
          {headers === undefined && !failed ? "Loading" : `${label} unavailable`}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.frame, frameStyle]}>
      <Image
        source={{ uri: mediaUrl(path), headers, cacheKey: path }}
        style={styles.image as ImageStyle}
        contentFit="contain"
        cachePolicy="memory-disk"
        accessibilityLabel={label}
        onError={() => setFailed(true)}
        onLoad={
          onSize
            ? (event) => {
                const { width: w, height: h } = event.source;
                if (w > 0 && h > 0) onSize(w, h);
              }
            : undefined
        }
      />
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
  fallback: {
    fontSize: 11,
    textAlign: "center",
    paddingHorizontal: 16,
  },
});
