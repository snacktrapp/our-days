import { useState, type ReactNode } from "react";
import {
  Modal,
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
}: Readonly<{
  title: string;
  items: readonly SwitcherItem[];
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onOpenAppearance: () => void;
  offset: number;
  interactive: boolean;
}>) {
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { colors } = theme;
  const hidden = offset > 0 && !open && !interactive;
  const titleFace = face(colors, 400, "record");

  return (
    <View
      pointerEvents={hidden ? "none" : "auto"}
      style={[
        styles.topbar,
        {
          top: insets.top + floatGap,
          backgroundColor: colors.navFill,
          borderColor: colors.hairline,
          transform: [{ translateY: -offset }],
        },
      ]}
    >
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
          <Wordmark color={colors.ink} width={104} />
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
        </Pressable>
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
  return (
    <View
      accessibilityRole="tablist"
      pointerEvents={hidden ? "none" : "auto"}
      style={[
        styles.nav,
        {
          bottom: insets.bottom + floatGap,
          backgroundColor: colors.navFill,
          borderColor: colors.hairline,
          transform: [{ translateY: offset }],
        },
      ]}
    >
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
        idle={colors.muted}
        face={label}
        icon={<NavAdd color={colors.muted} />}
      />
      <NavItem
        label="Circles"
        color={colors.action}
        idle={colors.muted}
        face={label}
        icon={<NavCircles color={colors.muted} />}
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
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.cream, borderColor: colors.hairline },
          ]}
          onPress={() => undefined}
        >
          <Text style={[styles.sheetTitle, face(colors, 600), { color: colors.ink }]}>
            Theme
          </Text>
          <Text style={[styles.sheetMeta, face(colors, 400, "record"), { color: colors.muted }]}>
            This device only
          </Text>
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
          {theme.appearance === "retro" ? (
            <View style={styles.swatches}>
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
            style={styles.signOut}
          >
            <Text style={[face(colors, 600), { color: colors.muted, fontSize: 14 }]}>
              {busy ? "Signing out" : "Sign out"}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  topbar: {
    position: "absolute",
    left: inlineGap,
    right: inlineGap,
    zIndex: 20,
    height: chromeHeight,
    minHeight: chromeHeight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: chromeRadius,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  iconHit: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
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
  titleButton: {
    alignItems: "center",
    maxWidth: "100%",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    maxWidth: "100%",
  },
  title: {
    fontSize: 10,
    lineHeight: 13,
    textTransform: "uppercase",
    textAlign: "center",
    flexShrink: 1,
  },
  chevron: {
    position: "absolute",
    left: "100%",
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
    position: "absolute",
    left: inlineGap,
    right: inlineGap,
    zIndex: 20,
    height: chromeHeight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: chromeRadius,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
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
    flex: 1,
    backgroundColor: "rgba(6, 12, 10, 0.46)",
    justifyContent: "flex-start",
    paddingTop: 96,
    paddingHorizontal: 24,
  },
  sheet: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    gap: 10,
  },
  sheetTitle: {
    fontSize: 15,
  },
  sheetMeta: {
    fontSize: 11,
    marginTop: -6,
  },
  choices: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 999,
    padding: 2,
    alignSelf: "flex-start",
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
  },
  swatch: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 2,
  },
  signOut: {
    minHeight: 44,
    alignItems: "flex-start",
    justifyContent: "center",
  },
});
