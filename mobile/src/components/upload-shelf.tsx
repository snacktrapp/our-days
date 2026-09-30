import { BlurView } from "expo-blur";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { dismissUpload, retryUpload, type UploadChip } from "../lib/posts";
import { getSupabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { chromeRadius, face, inlineGap } from "../lib/tokens";

/** Floating photo status chip. Same job as `.photo-status-shelf` on the web. */
export function UploadShelf({
  chips,
  top,
}: Readonly<{
  chips: readonly UploadChip[];
  top: number;
}>) {
  const { colors } = useAppTheme();
  const chip = chips.find((item) => item.failed) ?? chips.find((item) => !item.done) ?? chips[0];
  if (!chip) return null;
  const radius = colors.appearance === "retro" ? 2 : chromeRadius;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { top, left: inlineGap, right: inlineGap }]}
    >
      <View
        style={[
          styles.shelf,
          {
            borderColor: colors.hairline,
            borderRadius: radius,
            ...(Platform.OS === "web" && colors.navBlur > 0
              ? { backdropFilter: `blur(${colors.navBlur}px)` }
              : null),
          },
        ]}
      >
        <View pointerEvents="none" style={[styles.clip, { borderRadius: radius }]}>
          {Platform.OS !== "web" && colors.navBlur > 0 ? (
            <BlurView
              intensity={colors.navBlur * 5}
              tint={colors.scheme === "light" ? "light" : "dark"}
              style={[styles.fill, { borderRadius: radius }]}
            />
          ) : null}
          <View
            style={[styles.fill, { backgroundColor: colors.navFill, borderRadius: radius }]}
          />
        </View>
        <Text style={[face(colors, 700), styles.copy, { color: colors.ink }]}>{chip.label}</Text>
        {chip.detail ? (
          <Text style={[face(colors, 400), styles.detail, { color: colors.muted }]}>
            {chip.detail}
          </Text>
        ) : null}
        {chip.progress != null ? (
          <View style={[styles.track, { backgroundColor: "rgba(237,240,245,0.18)" }]}>
            <View
              style={[
                styles.fillBar,
                {
                  backgroundColor: colors.action,
                  width: `${Math.round(chip.progress * 100)}%`,
                },
              ]}
            />
          </View>
        ) : chip.failed || chip.done ? null : (
          <View style={[styles.track, { backgroundColor: "rgba(237,240,245,0.18)" }]}>
            <View style={[styles.fillBar, styles.indeterminate, { backgroundColor: colors.action }]} />
          </View>
        )}
        {chip.failed || chip.done ? (
          <View style={styles.actions}>
            {chip.failed ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const supabase = getSupabase();
                  if (supabase) void retryUpload(supabase, chip.id);
                }}
                style={styles.action}
              >
                <Text style={[face(colors, 650), { color: colors.ink }]}>Retry</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => dismissUpload(chip.id)}
              style={styles.action}
            >
              <Text style={[face(colors, 650), { color: colors.muted }]}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    zIndex: 30,
  },
  shelf: {
    overflow: "hidden",
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  clip: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
  },
  fill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  copy: {
    fontSize: 12,
    lineHeight: 16,
  },
  detail: {
    fontSize: 11,
    lineHeight: 15,
  },
  track: {
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  fillBar: {
    height: 6,
  },
  indeterminate: {
    width: "36%",
  },
  actions: {
    flexDirection: "row",
    gap: 6,
  },
  action: {
    minHeight: 44,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
