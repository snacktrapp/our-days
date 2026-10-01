import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "../lib/theme";
import { face, inlineGap, tracking } from "../lib/tokens";
import { DismissIcon } from "./icons";

/**
 * Quiet / promo card. Layout from globals.css `.journal-banner`.
 *
 * Copy is the mentions entry in src/features/timeline/journal-promo-config.ts.
 * `icon: "@"` is only the badge glyph (named marks are `bell`, `sparkle`,
 * and `bulb`). The labeled dismiss is `ctaLabel`, which the web
 * JournalBanner always paints as a pill. Both that pill and the X call
 * the same dismiss, and the journal writes `"dismissed"` to
 * `our-days:mentions-announcement`.
 */
const mentionsBanner = {
  glyph: "@",
  title: "Tag your people",
  body: "Type @ in a comment or caption to mention someone in the circle. They'll get a notice so they don't miss it.",
  ctaLabel: "Got it",
} as const;

export function MentionsBanner({ onDismiss }: Readonly<{ onDismiss: () => void }>) {
  const { colors } = useAppTheme();
  const retro = colors.appearance === "retro";
  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.banner,
        {
          backgroundColor: colors.cream,
          borderColor: colors.hairline,
          borderRadius: retro ? 2 : 18,
        },
      ]}
    >
      <View style={styles.copyRow}>
        <View style={[styles.badge, { backgroundColor: colors.selectionFill }]}>
          <Text style={[styles.glyph, face(colors, 500), { color: colors.action }]}>
            {mentionsBanner.glyph}
          </Text>
        </View>
        <View style={styles.copy}>
          <Text
            style={[
              styles.title,
              face(colors, 650),
              { color: colors.ink, letterSpacing: tracking(15, -0.01) },
            ]}
          >
            {mentionsBanner.title}
          </Text>
          <Text
            style={[
              styles.body,
              face(colors, 400),
              { color: colors.muted, fontSize: 13, lineHeight: 18 },
            ]}
          >
            {mentionsBanner.body}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onDismiss}
          style={[
            styles.cta,
            retro
              ? {
                  backgroundColor: accentSoft(colors.action),
                  borderColor: colors.action,
                }
              : { backgroundColor: colors.action, borderColor: "transparent" },
          ]}
        >
          <Text
            style={[
              face(colors, retro ? 700 : 650),
              styles.ctaLabel,
              {
                color: retro ? colors.action : colors.actionInk,
                letterSpacing: tracking(13, retro ? 0.08 : 0.005),
                textTransform: retro ? "uppercase" : "none",
              },
            ]}
          >
            {mentionsBanner.ctaLabel}
          </Text>
        </Pressable>
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

/** Retro `--accent-soft`: color-mix(accent 14%, transparent). */
function accentSoft(hex: string) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return hex;
  const channel = (start: number) => Number.parseInt(value.slice(start, start + 2), 16);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, 0.14)`;
}

const styles = StyleSheet.create({
  banner: {
    marginTop: 4,
    marginBottom: 8,
    marginHorizontal: inlineGap - 16,
    paddingTop: 14,
    paddingBottom: 10,
    paddingHorizontal: 14,
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
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    fontSize: 16,
    lineHeight: 18,
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
  actions: {
    marginTop: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 4,
  },
  cta: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaLabel: {
    fontSize: 13,
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
