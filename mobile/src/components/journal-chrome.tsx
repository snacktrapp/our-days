import { BlurView } from "expo-blur";
import { type ReactNode } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme } from "../lib/theme";
import {
  chromeHeight,
  chromeRadius,
  face,
  floatGap,
  inlineGap,
  tracking,
  type ThemeColors,
} from "../lib/tokens";
import {
  CheckIcon,
  ChevronDown,
  MoonIcon,
  NavAdd,
  NavCircles,
  NavFamily,
  NotificationMark,
  SettingsGear,
  SunIcon,
} from "./icons";
import { RetroWordmark } from "./retro-wordmark";
import { Wordmark } from "./wordmark";

export type SwitcherItem = Readonly<{
  id: string;
  label: string;
  selected: boolean;
}>;

export function JournalHeader({
  title,
  items,
  open,
  onToggle,
  onSelect,
  onOpenAppearance,
  offset,
  interactive,
  unseen = false,
  locked = false,
}: Readonly<{
  title: string;
  items: readonly SwitcherItem[];
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onOpenAppearance: () => void;
  offset: number;
  interactive: boolean;
  unseen?: boolean;
  /** Settings uses the static web title: wordmark and label, no chevron. */
  locked?: boolean;
}>) {
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { colors } = theme;
  const hidden = offset > 0 && !open && !interactive;
  const titleFace = face(colors, 400, "record");
  const radius = colors.appearance === "retro" ? 2 : chromeRadius;

  return (
    <View
      pointerEvents={hidden ? "none" : "auto"}
      style={[
        styles.barHost,
        {
          top: insets.top + floatGap,
          // Transform stays on this empty host. On iOS a transform makes the
          // view's own background a rectangle behind the rounded border.
          ...(offset > 0 ? { transform: [{ translateY: -offset }] } : null),
        },
      ]}
    >
    <View
      style={[
        styles.topbar,
        {
          borderColor: colors.hairline,
          borderRadius: radius,
          ...barShadow(colors),
          ...(Platform.OS === "web" && colors.navBlur > 0
            ? {
                backdropFilter: `blur(${colors.navBlur}px)`,
                WebkitBackdropFilter: `blur(${colors.navBlur}px)`,
              }
            : null),
        },
      ]}
    >
      <BarSurface radius={radius} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        onPress={onOpenAppearance}
        style={styles.iconHit}
      >
        <SettingsGear color={colors.muted} />
      </Pressable>
      <View style={styles.titleSlot} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={locked ? title : "Choose a journal"}
          accessibilityState={locked ? undefined : { expanded: open }}
          disabled={locked}
          onPress={onToggle}
          style={styles.titleButton}
        >
          <View style={styles.wordmark}>
            {colors.appearance === "retro" ? (
              <RetroWordmark />
            ) : (
              <Wordmark color={colors.ink} width={104} />
            )}
          </View>
          <View style={styles.titleRow}>
            <Text
              style={[
                styles.title,
                titleFace,
                { color: colors.ink, letterSpacing: tracking(10, 0.1) },
              ]}
              numberOfLines={2}
            >
              {title}
            </Text>
            {locked ? null : (
              <View style={styles.chevron}>
                <ChevronDown color={colors.ink} />
              </View>
            )}
          </View>
        </Pressable>
        {open && !locked ? (
          <View
            style={[
              styles.menu,
              {
                backgroundColor: colors.cream,
                borderColor: colors.hairline,
                borderRadius: colors.appearance === "retro" ? 2 : 10,
                shadowOpacity: colors.appearance === "retro" ? 0 : 0.32,
              },
            ]}
          >
            {items.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: item.selected }}
                onPress={() => onSelect(item.id)}
                style={({ pressed }) => [
                  styles.menuRow,
                  pressed && { backgroundColor: colors.selectionFill },
                ]}
              >
                <View style={styles.checkSlot}>
                  {item.selected ? <CheckIcon color={colors.ink} /> : null}
                </View>
                <Text
                  style={[
                    styles.menuLabel,
                    face(colors, item.selected ? 650 : 500, "record"),
                    { color: item.selected ? colors.ink : colors.muted },
                  ]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open notifications"
          style={styles.iconHit}
        >
          {/* TODO(noop): notification list. See src/lib/noop-controls.ts */}
          <NotificationMark color={colors.muted} />
          {unseen ? (
            <View
              style={[
                styles.unread,
                {
                  backgroundColor:
                    colors.appearance === "retro" ? colors.action : colors.clay,
                },
              ]}
            />
          ) : null}
        </Pressable>
        {colors.appearance === "retro" ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Use ${colors.scheme === "dark" ? "light" : "dark"} appearance`}
            onPress={theme.toggleScheme}
            style={styles.iconHit}
          >
            {colors.scheme === "dark" ? (
              <SunIcon color={colors.muted} />
            ) : (
              <MoonIcon color={colors.muted} />
            )}
          </Pressable>
        )}
      </View>
    </View>
    </View>
  );
}

export function JournalNav({
  offset,
  hidden,
  journalActive = true,
  onJournalPress,
}: Readonly<{
  offset: number;
  hidden: boolean;
  journalActive?: boolean;
  onJournalPress?: () => void;
}>) {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const label = face(colors, 600, "record");
  const radius = colors.appearance === "retro" ? 2 : chromeRadius;
  return (
    <View
      pointerEvents={hidden ? "none" : "auto"}
      style={[
        styles.barHost,
        {
          bottom: insets.bottom + floatGap,
          ...(offset > 0 ? { transform: [{ translateY: offset }] } : null),
        },
      ]}
    >
    <View
      accessibilityRole="tablist"
      style={[
        styles.nav,
        {
          borderColor: colors.hairline,
          borderRadius: radius,
          ...barShadow(colors),
          ...(Platform.OS === "web" && colors.navBlur > 0
            ? {
                backdropFilter: `blur(${colors.navBlur}px)`,
                WebkitBackdropFilter: `blur(${colors.navBlur}px)`,
              }
            : null),
        },
      ]}
    >
      <BarSurface radius={radius} />
      <NavItem
        label="Journal"
        active={journalActive}
        onPress={onJournalPress}
        color={colors.action}
        idle={colors.muted}
        face={label}
        icon={<NavFamily color={journalActive ? colors.action : colors.muted} />}
      />
      <NavItem
        label="Add"
        color={colors.action}
        idle={colors.appearance === "retro" ? colors.ink : colors.muted}
        face={label}
        icon={<NavAdd color={colors.appearance === "retro" ? colors.ink : colors.muted} />}
      />
      <NavItem
        label="Circles"
        color={colors.action}
        idle={colors.appearance === "retro" ? colors.ink : colors.muted}
        face={label}
        icon={<NavCircles color={colors.appearance === "retro" ? colors.ink : colors.muted} />}
      />
    </View>
    </View>
  );
}

/** iOS blur under the same fill the web paints with backdrop-filter. Retro’s blur is 0. */
function barShadow(colors: ThemeColors) {
  if (colors.appearance === "retro") {
    return { shadowOpacity: 0, elevation: 0 };
  }
  const light = colors.scheme === "light";
  return {
    shadowColor: light ? "rgb(58, 44, 31)" : "#000",
    shadowOpacity: light ? 0.12 : 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: light ? 2 : 8,
  };
}

/**
 * One clipped layer: the blur, then the web fill painted once on top of it.
 * A second fill on the pill or this clip stacks the same rgba and kills the
 * translucency. The header menu stays outside so it can hang open.
 */
function BarSurface({ radius }: Readonly<{ radius: number }>) {
  const { colors } = useAppTheme();
  return (
    <View
      pointerEvents="none"
      collapsable={false}
      style={[
        styles.barClip,
        { borderRadius: radius },
      ]}
    >
      {Platform.OS !== "web" && colors.navBlur > 0 ? (
        <BlurView
          intensity={colors.navBlur * 5}
          tint={colors.scheme === "light" ? "light" : "dark"}
          style={[styles.barClipFill, { borderRadius: radius }]}
        />
      ) : null}
      <View
        style={[
          styles.barClipFill,
          { backgroundColor: colors.navFill, borderRadius: radius },
        ]}
      />
    </View>
  );
}

function NavItem({
  label,
  active = false,
  onPress,
  color,
  idle,
  face: type,
  icon,
}: Readonly<{
  label: string;
  active?: boolean;
  onPress?: () => void;
  color: string;
  idle: string;
  face: ReturnType<typeof face>;
  icon: ReactNode;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.navItem}
    >
      {/* TODO(noop): Add and Circles do not navigate. See noop-controls.ts */}
      {icon}
      <Text
        style={[
          styles.navLabel,
          type,
          {
            color: active ? color : idle,
            letterSpacing: tracking(8, 0.12),
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  barClip: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
  },
  barClipFill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
  },
  barHost: {
    position: "absolute",
    left: inlineGap,
    right: inlineGap,
    zIndex: 20,
  },
  topbar: {
    height: chromeHeight,
    minHeight: chromeHeight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: chromeRadius,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconHit: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  unread: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  titleSlot: {
    position: "absolute",
    left: 88,
    right: 88,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: {
    height: 20,
    marginBottom: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  titleButton: {
    alignSelf: "center",
    alignItems: "center",
    maxWidth: "100%",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    maxWidth: "100%",
  },
  title: {
    fontSize: 10,
    lineHeight: 13,
    textTransform: "uppercase",
    textAlign: "center",
    flexGrow: 0,
    flexShrink: 1,
  },
  chevron: {
    width: 14,
    height: 14,
    marginLeft: 4,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
  },
  menu: {
    position: "absolute",
    top: chromeHeight + 4,
    width: 220,
    maxWidth: "100%",
    padding: 4,
    borderWidth: 1,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 21,
    shadowOffset: { width: 0, height: 18 },
    elevation: 12,
    zIndex: 30,
  },
  menuRow: {
    minHeight: 44,
    paddingVertical: 8,
    paddingRight: 10,
    paddingLeft: 8,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkSlot: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: {
    flex: 1,
    fontSize: 14,
  },
  nav: {
    height: chromeHeight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: chromeRadius,
    flexDirection: "row",
    alignItems: "center",
  },
  navItem: {
    flex: 1,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  navLabel: {
    fontSize: 8,
    lineHeight: 10,
    textTransform: "uppercase",
  },
});
