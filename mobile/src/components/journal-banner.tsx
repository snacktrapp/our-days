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
      <View style={[styles.badge, { backgroundColor: colors.selectionFill }]}>
        <Text style={[styles.glyph, face(colors, 500), { color: colors.action }]}>@</Text>
      </View>
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
          colors.appearance === "retro"
            ? { color: colors.ink, fontSize: 15, lineHeight: 23 }
            : { color: colors.muted },
        ]}
      >
        Type @ in a comment or caption to mention someone in the circle. They’ll
        get a notice so they don’t miss it.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onDismiss}
        style={[
          styles.cta,
          colors.appearance === "retro"
            ? {
                backgroundColor: colors.selectionFill,
                borderWidth: 1,
                borderColor: colors.action,
              }
            : { backgroundColor: colors.action },
        ]}
      >
        <Text
          style={[
            face(colors, colors.appearance === "retro" ? 700 : 650),
            {
              color: colors.appearance === "retro" ? colors.action : colors.actionInk,
              fontSize: 13,
              textTransform: colors.appearance === "retro" ? "uppercase" : "none",
              letterSpacing: colors.appearance === "retro" ? 1 : 0,
            },
          ]}
        >
          Got it
        </Text>
      </Pressable>
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
    marginTop: 6,
    marginBottom: 14,
    marginHorizontal: inlineGap - 16,
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 18,
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 12,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    fontSize: 16,
  },
  title: {
    flex: 1,
    fontSize: 15,
    lineHeight: 19,
    paddingRight: 26,
  },
  body: {
    width: "100%",
    marginLeft: 44,
    marginTop: -14,
    fontSize: 13,
    lineHeight: 18,
  },
  cta: {
    marginTop: 8,
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
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
