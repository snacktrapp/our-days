import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "../lib/theme";
import { face, inlineGap, tracking } from "../lib/tokens";
import { DismissIcon } from "./icons";

/**
 * Quiet / promo card. Layout from globals.css `.journal-banner`.
 * Copy from src/features/timeline/journal-promo-config.ts (mentions).
 */
export function MentionsBanner({ onDismiss }: Readonly<{ onDismiss: () => void }>) {
  const { colors } = useAppTheme();
  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.banner,
        {
          backgroundColor: colors.cream,
          borderColor: colors.hairline,
          borderRadius: colors.appearance === "retro" ? 2 : 18,
        },
      ]}
    >
      <View style={styles.copyRow}>
        <View style={[styles.badge, { backgroundColor: colors.selectionFill }]}>
          <Text style={[styles.glyph, face(colors, 500), { color: colors.action }]}>@</Text>
        </View>
        <View style={styles.copy}>
          <Text
            style={[
              styles.title,
              face(colors, 650),
              { color: colors.ink, letterSpacing: tracking(15, -0.01) },
            ]}
          >
            Tag your people
          </Text>
          <Text
            style={[
              styles.body,
              face(colors, 400),
              { color: colors.muted, fontSize: 13, lineHeight: 17 },
            ]}
            numberOfLines={2}
          >
            Type @ in a comment or caption to mention someone in the circle.
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        style={styles.dismiss}
      >
        <DismissIcon color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: 4,
    marginBottom: 8,
    marginHorizontal: inlineGap - 16,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
  },
  copyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 12,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    fontSize: 16,
  },
  title: {
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 19,
    paddingRight: 26,
  },
  body: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  dismiss: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
