import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  profileAccent,
  profileColorChoices,
  profileColorName,
  type ProfileColorToken,
} from "../lib/profile-accent";
import type { ViewerProfile } from "../lib/journal";
import { useAppTheme } from "../lib/theme";
import {
  accentIds,
  dotColor,
  dotInk,
  face,
  retroAccentHex,
  stageChromeInset,
  tracking,
  type AccentId,
} from "../lib/tokens";
import { ChevronRight } from "./icons";

/**
 * Web account settings: src/features/family-settings/account-screen.tsx
 * (profile color + AccountTools) inside `.settings-page`.
 */
export function SettingsScreen({
  profile,
  onSaveColor,
  onSignOut,
  onScroll,
}: Readonly<{
  profile: ViewerProfile | null;
  onSaveColor: (color: ProfileColorToken) => Promise<{ ok: boolean; message: string }>;
  onSignOut: () => void;
  onScroll?: (y: number) => void;
}>) {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const radius = colors.appearance === "retro" ? 2 : 18;
  return (
    <ScrollView
      style={styles.fill}
      onScroll={
        onScroll
          ? (event) => onScroll(event.nativeEvent.contentOffset.y)
          : undefined
      }
      scrollEventThrottle={16}
      contentContainerStyle={{
        paddingTop: insets.top + stageChromeInset + 20,
        paddingBottom: insets.bottom + stageChromeInset + 56 + 10 + 28,
        paddingHorizontal: 16,
        gap: 28,
      }}
    >
      {profile ? (
        <ProfileGroup
          key={profile.id}
          profile={profile}
          radius={radius}
          onSaveColor={onSaveColor}
        />
      ) : null}
      <View style={[styles.group, { backgroundColor: colors.cream, borderRadius: radius }]}>
        <ThemeRow />
        {colors.appearance === "retro" ? <AccentRow /> : null}
        <NotificationsRow />
        {/* TODO(noop): Recently removed does not open trash. See noop-controls.ts */}
        <PlainRow
          title="Recently removed"
          subtitle="Moments you may want back"
          trail={<ChevronRight color={colors.muted} />}
        />
      </View>
      <View style={[styles.group, { backgroundColor: colors.cream, borderRadius: radius }]}>
        <SignOutRow onSignOut={onSignOut} />
      </View>
    </ScrollView>
  );
}

function ProfileGroup({
  profile,
  radius,
  onSaveColor,
}: Readonly<{
  profile: ViewerProfile;
  radius: number;
  onSaveColor: (color: ProfileColorToken) => Promise<{ ok: boolean; message: string }>;
}>) {
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(profile.accentToken);
  const [saved, setSaved] = useState(profile.accentToken);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const accent = profileAccent(selected);
  const titleSize = colors.appearance === "retro" ? 16 : 15;
  return (
    <View style={[styles.group, { backgroundColor: colors.cream, borderRadius: radius }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={styles.profileRow}
      >
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: dotColor(accent, colors),
              borderRadius: colors.appearance === "retro" ? 2 : 20,
            },
          ]}
        >
          <Text style={[face(colors, 700), styles.avatarLetter, { color: dotInk(accent, colors) }]}>
            {profile.initial}
          </Text>
        </View>
        <View style={styles.copy}>
          <Text style={[face(colors, 600), styles.rowTitle, { color: colors.ink, fontSize: titleSize }]}>
            {profile.name}
          </Text>
          <Text style={[face(colors, 400), metaType(colors.appearance), { color: colors.muted }]}>
            {`Your color · ${profileColorName(selected)}`}
          </Text>
        </View>
        <ChevronRight color={colors.muted} />
      </Pressable>
      {open ? (
        <View style={styles.expanded}>
          <View style={[styles.hairline, { backgroundColor: colors.hairline }]} />
          <View accessibilityRole="radiogroup" style={styles.swatches}>
            {profileColorChoices.map((option) => {
              const on = selected === option.token;
              return (
                <Pressable
                  key={option.token}
                  accessibilityRole="radio"
                  accessibilityLabel={option.name}
                  accessibilityState={{ selected: on }}
                  disabled={pending}
                  onPress={() => {
                    setSelected(option.token);
                    setMessage("");
                  }}
                  style={[styles.swatchHit, on && { borderColor: colors.ink }]}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: dotColor(option.accent, colors), borderRadius: radius === 2 ? 2 : 12 },
                    ]}
                  >
                    {on ? (
                      <Text style={{ color: dotInk(option.accent, colors), fontSize: 16, fontWeight: "700" }}>
                        ✓
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={pending || selected === saved}
            onPress={() => {
              if (selected === saved) return;
              const choice = selected as ProfileColorToken;
              setPending(true);
              setMessage("");
              void onSaveColor(choice).then((result) => {
                setPending(false);
                setFailed(!result.ok);
                setMessage(result.message);
                if (result.ok) setSaved(choice);
              });
            }}
            style={[
              styles.save,
              {
                backgroundColor: colors.action,
                borderRadius: radius === 2 ? 2 : 12,
                opacity: pending || selected === saved ? 0.45 : 1,
              },
            ]}
          >
            <Text style={[face(colors, 600), { color: colors.actionInk, fontSize: 14 }]}>
              {pending ? "Saving…" : "Save color"}
            </Text>
          </Pressable>
          {message ? (
            <Text
              accessibilityRole={failed ? "alert" : "text"}
              style={[face(colors, 400), styles.hint, { color: failed ? colors.danger : colors.muted }]}
            >
              {message}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ThemeRow() {
  const theme = useAppTheme();
  const { colors } = theme;
  return (
    <View style={styles.plainRow}>
      <View style={styles.copy}>
        <Text
          style={[
            face(colors, 600),
            styles.rowTitle,
            { color: colors.ink, fontSize: colors.appearance === "retro" ? 16 : 15 },
          ]}
        >
          Theme
        </Text>
        <Text style={[face(colors, 400), metaType(colors.appearance), { color: colors.muted }]}>
          This device only
        </Text>
      </View>
      <View
        accessibilityRole="radiogroup"
        style={[
          styles.choices,
          { borderColor: colors.hairline, backgroundColor: wash(colors.ink, 0.08) },
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
              style={[styles.choice, selected && { backgroundColor: colors.ink }]}
            >
              <Text
                style={[
                  face(colors, 600),
                  { color: selected ? colors.paper : colors.muted, fontSize: 12 },
                ]}
              >
                {name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function AccentRow() {
  const theme = useAppTheme();
  const { colors } = theme;
  return (
    <View style={styles.accentRow}>
      <View style={[styles.hairline, { backgroundColor: colors.hairline }]} />
      <View style={styles.accentHead}>
        <View style={styles.copy}>
          <Text style={[face(colors, 600), styles.rowTitle, { color: colors.ink, fontSize: 16 }]}>
            Accent
          </Text>
          <Text style={[face(colors, 400), metaType(colors.appearance), { color: colors.muted }]}>
            This device only
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => theme.setAccent("orange")}
          style={[styles.reset, { borderColor: colors.hairline }]}
        >
          <Text
            style={[
              face(colors, 700),
              {
                color: colors.muted,
                fontSize: 10,
                letterSpacing: tracking(10, 0.08),
                textTransform: "uppercase",
              },
            ]}
          >
            Reset
          </Text>
        </Pressable>
      </View>
      <View accessibilityRole="radiogroup" style={styles.accentSwatches}>
        {accentIds.map((id) => {
          const selected = theme.accent === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityLabel={id}
              accessibilityState={{ selected }}
              onPress={() => theme.setAccent(id as AccentId)}
              style={[
                styles.accentSwatch,
                { backgroundColor: retroAccentHex[id], borderColor: colors.hairline },
                selected && { borderColor: colors.ink, borderWidth: 2 },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

function NotificationsRow() {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.plainRow, { opacity: 0.72 }]}>
      <View style={[styles.hairline, { backgroundColor: colors.hairline }]} />
      <View style={styles.copy}>
        <Text
          style={[
            face(colors, 600),
            styles.rowTitle,
            { color: colors.ink, fontSize: colors.appearance === "retro" ? 16 : 15 },
          ]}
        >
          Notifications
        </Text>
        {/* TODO(noop): Push is not wired. Web shows this when push is unconfigured. */}
        <Text style={[face(colors, 400), metaType(colors.appearance), { color: colors.muted }]}>
          Not available yet.
        </Text>
      </View>
      <View
        accessibilityRole="switch"
        accessibilityState={{ checked: false, disabled: true }}
        style={[styles.switchTrack, { backgroundColor: colors.line }]}
      >
        <View
          style={[
            styles.switchKnob,
            { backgroundColor: colors.appearance === "retro" ? colors.ink : "#f4f6f2" },
          ]}
        />
      </View>
    </View>
  );
}

function PlainRow({
  title,
  subtitle,
  trail,
}: Readonly<{ title: string; subtitle: string; trail: ReactNode }>) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.plainRow}>
      <View style={[styles.hairline, { backgroundColor: colors.hairline }]} />
      <View style={styles.copy}>
        <Text
          style={[
            face(colors, 600),
            styles.rowTitle,
            { color: colors.ink, fontSize: colors.appearance === "retro" ? 16 : 15 },
          ]}
        >
          {title}
        </Text>
        <Text style={[face(colors, 400), metaType(colors.appearance), { color: colors.muted }]}>
          {subtitle}
        </Text>
      </View>
      {trail}
    </View>
  );
}

function SignOutRow({ onSignOut }: Readonly<{ onSignOut: () => void }>) {
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={() => {
        setBusy(true);
        onSignOut();
      }}
      style={styles.signOut}
    >
      <Text
        style={[
          face(colors, 600),
          { color: colors.ink, fontSize: colors.appearance === "retro" ? 16 : 15, lineHeight: 20 },
        ]}
      >
        {busy ? "Signing out…" : "Sign out"}
      </Text>
    </Pressable>
  );
}

function metaType(appearance: "standard" | "retro") {
  return appearance === "retro"
    ? { fontSize: 15, lineHeight: 23 }
    : { fontSize: 12, lineHeight: 17 };
}

function wash(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return `rgba(128, 128, 128, ${alpha})`;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  group: {
    overflow: "hidden",
  },
  profileRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 16,
    paddingRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    fontSize: 16,
    lineHeight: 16,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    lineHeight: 20,
  },
  expanded: {
    position: "relative",
    gap: 14,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  swatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingTop: 8,
  },
  swatchHit: {
    width: "16.666%",
    aspectRatio: 1,
    padding: 6,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatch: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  save: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
  },
  plainRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 16,
    paddingRight: 12,
  },
  hairline: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 0,
    height: 1,
  },
  choices: {
    flexDirection: "row",
    flexShrink: 0,
    borderWidth: 1,
    borderRadius: 999,
    padding: 2,
  },
  choice: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  accentRow: {
    gap: 8,
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  accentHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  reset: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  accentSwatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  accentSwatch: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 2,
  },
  switchTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
  },
  switchKnob: {
    position: "absolute",
    top: 2,
    left: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  signOut: {
    minHeight: 56,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
});
