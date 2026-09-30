import { BlurView } from "expo-blur";
import { useState, type ReactNode } from "react";
import {
  Modal,
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
  retroAccentHex,
  tracking,
  type AccentId,
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

const accentOrder: readonly AccentId[] = [
  "orange",
  "green",
  "amber",
  "blue",
  "pink",
  "violet",
];

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
          backgroundColor: colors.navFill,
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
          accessibilityLabel="Choose a journal"
          accessibilityState={{ expanded: open }}
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
            <View style={styles.chevron}>
              <ChevronDown color={colors.ink} />
            </View>
          </View>
        </Pressable>
        {open ? (
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
}: Readonly<{ offset: number; hidden: boolean }>) {
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
          backgroundColor: colors.navFill,
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
        active
        color={colors.action}
        idle={colors.muted}
        face={label}
        icon={<NavFamily color={colors.action} />}
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
 * Blur and fill live in one clipped layer. On iOS a BlurView ignores the
 * parent's borderRadius unless that layer also has overflow hidden and the
 * same radius. The header menu stays outside this layer so it can hang open.
 */
function BarSurface({ radius }: Readonly<{ radius: number }>) {
  const { colors } = useAppTheme();
  return (
    <View
      pointerEvents="none"
      collapsable={false}
      style={[
        styles.barClip,
        { borderRadius: radius, backgroundColor: colors.navFill },
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
  color,
  idle,
  face: type,
  icon,
}: Readonly<{
  label: string;
  active?: boolean;
  color: string;
  idle: string;
  face: ReturnType<typeof face>;
  icon: ReactNode;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
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

export function AppearanceSheet({
  visible,
  onClose,
  onSignOut,
}: Readonly<{
  visible: boolean;
  onClose: () => void;
  onSignOut: () => void;
}>) {
  const theme = useAppTheme();
  const { colors } = theme;
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  // Sits on the header the way the web drawer does: 10px under the pill,
  // same side inset, transparent scrim (tap outside closes). No fade.
  const radius = colors.appearance === "retro" ? 2 : 18;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.scrim}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close settings"
          onPress={onClose}
          style={styles.scrimHit}
        />
        <View
          style={[
            styles.sheet,
            {
              top: insets.top + floatGap + chromeHeight + 10,
              backgroundColor: colors.cream,
              borderColor: colors.hairline,
              borderRadius: radius,
              shadowOpacity: colors.appearance === "retro" ? 0 : 0.32,
            },
          ]}
        >
          <View style={styles.themeRow}>
            <View style={styles.themeCopy}>
              <Text style={[styles.sheetTitle, face(colors, 600), { color: colors.ink }]}>
                Theme
              </Text>
              <Text
                style={[styles.sheetMeta, face(colors, 400), { color: colors.muted }]}
              >
                This device only
              </Text>
            </View>
            <View
              accessibilityRole="radiogroup"
              style={[
                styles.choices,
                { borderColor: colors.hairline, backgroundColor: colors.selectionFill },
              ]}
            >
            {(
              [
                ["standard", "Standard"],
                ["retro", "Future"],
              ] as const
            ).map(([id, name]) => {
              const selected = theme.appearance === id;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => theme.setAppearance(id)}
                  style={[
                    styles.choice,
                    selected && { backgroundColor: colors.ink },
                  ]}
                >
                  <Text
                    style={[
                      face(colors, 600),
                      {
                        color: selected ? colors.paper : colors.muted,
                        fontSize: 12,
                      },
                    ]}
                  >
                    {name}
                  </Text>
                </Pressable>
              );
            })}
            </View>
          </View>
          {theme.appearance === "retro" ? (
            <View style={[styles.swatches, { borderTopColor: colors.hairline }]}>
              {accentOrder.map((id) => {
                const selected = theme.accent === id;
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="radio"
                    accessibilityLabel={id}
                    accessibilityState={{ selected }}
                    onPress={() => theme.setAccent(id)}
                    style={[
                      styles.swatch,
                      { borderRadius: 2 },
                      {
                        backgroundColor: retroAccentHex[id],
                        borderColor: colors.hairline,
                      },
                      selected && { borderColor: colors.ink, borderWidth: 2 },
                    ]}
                  />
                );
              })}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              setBusy(true);
              onSignOut();
            }}
            style={[styles.signOut, { borderTopColor: colors.hairline }]}
          >
            <Text style={[face(colors, 600), { color: colors.muted, fontSize: 14 }]}>
              {busy ? "Signing out" : "Sign out"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  scrimHit: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sheet: {
    position: "absolute",
    left: inlineGap,
    right: inlineGap,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowRadius: 21,
    shadowOffset: { width: 0, height: 18 },
    elevation: 12,
  },
  themeRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 16,
    paddingRight: 12,
  },
  themeCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sheetTitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  sheetMeta: {
    fontSize: 12,
    lineHeight: 17,
  },
  choices: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 999,
    padding: 2,
    flexShrink: 0,
  },
  choice: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  swatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderTopWidth: 1,
  },
  swatch: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 2,
  },
  signOut: {
    minHeight: 56,
    paddingHorizontal: 16,
    alignItems: "flex-start",
    justifyContent: "center",
    borderTopWidth: 1,
  },
});
