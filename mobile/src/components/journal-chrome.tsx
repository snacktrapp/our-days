import { BlurView } from "expo-blur";
import { MenuView } from "@expo/ui/community/menu";
import { useState, type ReactNode } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
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
  NavFamily,
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
  /** Settings uses the static web title: wordmark and label, no chevron. */
  locked?: boolean;
}>) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const theme = useAppTheme();
  const { colors } = theme;
  const hidden = offset > 0 && !open && !interactive;
  const menuWidth = Math.min(220, windowWidth - 32);
  const [anchor, setAnchor] = useState({ width: 0, height: 0 });
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
        <View
          style={styles.titleAnchor}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setAnchor((current) =>
              current.width === width && current.height === height
                ? current
                : { width, height },
            );
          }}
        >
        {locked || Platform.OS !== "ios" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={locked ? title : "Choose a journal"}
          accessibilityState={locked ? undefined : { expanded: open }}
          disabled={locked}
          onPress={onToggle}
          style={styles.titleButton}
        >
          <JournalTitle title={title} locked={locked} open={open} />
        </Pressable>
        ) : (
          <MenuView
            actions={items.map((item) => ({
              id: item.id,
              title: item.label,
              state: item.selected ? ("on" as const) : ("off" as const),
            }))}
            onPressAction={(event) => onSelect(event.nativeEvent.event)}
          >
            <View accessibilityRole="button" accessibilityLabel="Choose a journal" style={styles.titleButton}>
              <JournalTitle title={title} locked={false} open={false} />
            </View>
          </MenuView>
        )}
        {open && !locked && Platform.OS !== "ios" ? (
          <View
            style={[
              styles.menu,
              Platform.OS === "web" ? null : menuChrome(colors),
              {
                width: menuWidth,
                top: anchor.height + 10,
                left: (anchor.width - menuWidth) / 2,
              },
            ]}
          >
            <View
              style={[
                styles.menuSurface,
                Platform.OS === "web" ? menuChrome(colors) : null,
                {
                  borderColor: colors.hairline,
                  backgroundColor:
                    colors.appearance === "retro"
                      ? colors.cream
                      : creamWash(colors.cream, colors.scheme),
                  ...(Platform.OS === "web" && colors.appearance !== "retro"
                    ? {
                        backdropFilter: "blur(18px)",
                        WebkitBackdropFilter: "blur(18px)",
                      }
                    : null),
                },
              ]}
            >
              {Platform.OS !== "web" && colors.appearance !== "retro" ? (
                <BlurView
                  pointerEvents="none"
                  intensity={90}
                  tint={colors.scheme === "light" ? "light" : "dark"}
                  style={styles.menuBlur}
                />
              ) : null}
              {items.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.selected }}
                  onPress={() => onSelect(item.id)}
                  style={({ pressed }) => [
                    styles.menuRow,
                    pressed && {
                      backgroundColor: accentPress(colors.action),
                      transform: [{ scale: 0.985 }],
                    },
                  ]}
                >
                  {({ pressed }) => (
                    <>
                      <View style={styles.checkSlot}>
                        {item.selected ? <CheckIcon color={colors.ink} /> : null}
                      </View>
                      <Text
                        style={[
                          styles.menuLabel,
                          face(colors, item.selected ? 650 : 500, "record"),
                          {
                            color:
                              item.selected || pressed ? colors.ink : colors.muted,
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {item.label}
                      </Text>
                    </>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        </View>
      </View>
      <View style={styles.actions}>
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
  onAddPress,
}: Readonly<{
  offset: number;
  hidden: boolean;
  journalActive?: boolean;
  onJournalPress?: () => void;
  onAddPress?: () => void;
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
        idle={colors.appearance === "retro" ? colors.ink : colors.muted}
        face={label}
        icon={
          <NavFamily
            color={
              journalActive
                ? colors.action
                : colors.appearance === "retro"
                  ? colors.ink
                  : colors.muted
            }
          />
        }
      />
      <NavItem
        label="Add"
        color={colors.action}
        idle={colors.appearance === "retro" ? colors.ink : colors.muted}
        face={label}
        onPress={onAddPress}
        icon={<NavAdd color={colors.appearance === "retro" ? colors.ink : colors.muted} />}
      />
    </View>
    </View>
  );
}

function JournalTitle({
  title,
  locked,
  open,
}: Readonly<{ title: string; locked: boolean; open: boolean }>) {
  const { colors } = useAppTheme();
  const titleFace = face(colors, 400, "record");
  return (
    <>
      <View style={styles.wordmark}>
        {colors.appearance === "retro" ? <RetroWordmark /> : <Wordmark color={colors.ink} width={104} />}
      </View>
      <View style={styles.titleRow}>
        <Text
          style={[styles.title, titleFace, { color: colors.ink, letterSpacing: tracking(10, 0.1) }]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {locked ? null : (
          <View style={[styles.chevron, open ? { transform: [{ rotate: "180deg" }] } : null]}>
            <ChevronDown color={colors.ink} />
          </View>
        )}
      </View>
    </>
  );
}

/** --overlay-popover-fill: cream at 88% (dark) or 90% (light). */
function creamWash(cream: string, scheme: ThemeColors["scheme"]) {
  return hexAlpha(cream, scheme === "light" ? 0.9 : 0.88);
}

/** `.title-switcher nav a:active` uses color-mix(accent 18%, transparent). */
function accentPress(action: string) {
  return hexAlpha(action, 0.18);
}

function hexAlpha(hex: string, alpha: number) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * `.title-switcher nav` uses --header-drawer-shadow. Retro sets that to none.
 * On iOS the shadow stays on the outer menu so the clipped blur inside does
 * not square it off. Expo web paints boxShadow on the surface.
 */
function menuChrome(colors: ThemeColors) {
  if (colors.appearance === "retro") {
    return Platform.OS === "web"
      ? { boxShadow: "none" }
      : { shadowOpacity: 0, elevation: 0 };
  }
  if (Platform.OS === "web") {
    return {
      boxShadow:
        colors.scheme === "light"
          ? "0 18px 42px rgba(25, 35, 52, 0.18)"
          : "0 18px 42px rgba(0, 0, 0, 0.32)",
    };
  }
  if (colors.scheme === "light") {
    return {
      shadowColor: "rgb(25, 35, 52)",
      shadowOpacity: 0.18,
      shadowRadius: 42,
      shadowOffset: { width: 0, height: 18 },
      elevation: 8,
    };
  }
  return {
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 42,
    shadowOffset: { width: 0, height: 18 },
    elevation: 12,
  };
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
    zIndex: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  wordmark: {
    height: 20,
    marginBottom: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  titleAnchor: {
    position: "relative",
    alignSelf: "center",
    alignItems: "center",
    maxWidth: "100%",
  },
  titleButton: {
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
    zIndex: 30,
    borderRadius: 10,
  },
  menuSurface: {
    padding: 4,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
  },
  menuBlur: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
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
