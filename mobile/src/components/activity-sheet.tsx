import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  loadActivity,
  rememberSeenActivity,
  type ActivityItem,
} from "../lib/activity";
import type { CircleMembership } from "../lib/journal";
import { getSupabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { face } from "../lib/tokens";

/** Web notification center: Activity sheet opened from the header heart. */
export function ActivitySheet({
  circles,
  onClose,
  onOpen,
}: Readonly<{
  circles: readonly CircleMembership[];
  onClose: () => void;
  onOpen: (href: string) => void;
}>) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const retro = colors.appearance === "retro";
  const light = colors.scheme === "light" && !retro;
  const scrim = retro ? "#100d0c" : light ? "rgba(32,39,33,0.42)" : "rgba(0,5,3,0.72)";
  const [items, setItems] = useState<readonly ActivityItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const supabase = getSupabase();
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void loadActivity(supabase, circles)
      .then((loaded) => {
        if (!active) return;
        setFailed(false);
        setItems(loaded);
        rememberSeenActivity(loaded.map((item) => item.id));
      })
      .catch(() => {
        if (!active) return;
        setItems([]);
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [attempt, circles, supabase]);
  const showFailure = failed || !supabase;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: scrim }]}>
        <Pressable accessibilityLabel="Close" style={styles.scrimTap} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: retro ? colors.cream : colors.paper,
              borderColor: colors.hairline,
              borderTopLeftRadius: retro ? 2 : 14,
              borderTopRightRadius: retro ? 2 : 14,
              paddingBottom: Math.max(16, insets.bottom),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: retro ? "#6f655b" : "#526158" }]} />
          <Text style={[face(colors, 650), styles.title, { color: colors.ink }]}>Activity</Text>
          <ScrollView contentContainerStyle={styles.body}>
            {items == null && supabase ? (
              <View style={styles.statusRow}>
                <ActivityIndicator color={colors.ink} />
                <Text style={[face(colors, 400), { color: colors.muted, fontSize: 15 }]}>
                  Checking for new activity…
                </Text>
              </View>
            ) : null}
            {showFailure ? (
              <View style={styles.statusRow}>
                <Text style={[face(colors, 400), { color: colors.ink, fontSize: 15 }]}>
                  Activity couldn’t be refreshed.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setFailed(false);
                    setItems(null);
                    setAttempt((current) => current + 1);
                  }}
                >
                  <Text style={[face(colors, 650), { color: colors.action, fontSize: 15 }]}>Try again</Text>
                </Pressable>
              </View>
            ) : null}
            {items && items.length === 0 && !showFailure ? (
              <Text style={[face(colors, 400), { color: colors.muted, fontSize: 15 }]}>No new activity.</Text>
            ) : null}
            {items?.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => onOpen(item.href)}
                style={[styles.row, { borderTopColor: colors.hairline }]}
              >
                <Text style={[face(colors, 400), { color: colors.ink, fontSize: 15, lineHeight: 21 }]}>
                  <Text style={face(colors, 700)}>{item.actorName}</Text> {item.message}
                </Text>
                <Text style={[face(colors, 400, "record"), { color: colors.muted, fontSize: 11 }]}>
                  {item.displayDate}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end" },
  scrimTap: { flex: 1 },
  sheet: {
    maxHeight: "88%",
    minHeight: 280,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  handle: {
    position: "absolute",
    top: 10,
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 999,
  },
  title: { marginTop: 28, textAlign: "center", fontSize: 17, lineHeight: 22 },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 8 },
  statusRow: { gap: 8, paddingVertical: 12 },
  row: { gap: 4, paddingVertical: 12, borderTopWidth: 1 },
});
