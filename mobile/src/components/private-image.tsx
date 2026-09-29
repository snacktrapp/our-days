import { Image, type ImageStyle } from "expo-image";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { mediaUrl } from "../lib/supabase";
import { colors, record } from "../lib/theme";

export function PrivateImage({
  path,
  width,
  height,
  label,
  headers,
}: Readonly<{
  path: string;
  width?: number;
  height?: number;
  label: string;
  headers?: Record<string, string> | null;
}>) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Intentional reset when the source changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFailed(false);
  }, [path, headers]);

  const aspectRatio = width && height && height > 0 ? width / height : 4 / 3;

  if (failed || !headers) {
    return (
      <View style={[styles.fallback, { aspectRatio }]}>
        <Text style={styles.fallbackText}>
          {headers === undefined && !failed ? "Loading" : `${label} unavailable`}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: mediaUrl(path), headers }}
      style={[styles.image, { aspectRatio }] as ImageStyle[]}
      contentFit="cover"
      cachePolicy="none"
      accessibilityLabel={label}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  fallback: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  fallbackText: {
    ...record,
    fontSize: 11,
  },
});
