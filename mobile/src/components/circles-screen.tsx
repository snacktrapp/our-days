import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { circleNameError, createCircle, createCircleSourceId } from "../lib/circles";
import { postableCircles, type CircleMembership } from "../lib/journal";
import { loadRosters, peopleCountLabel, type CirclePerson } from "../lib/roster";
import { getSupabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { dotColor, dotInk, face, tracking } from "../lib/tokens";
import { InviteSendSheet } from "./invite-sheet";
import { Symbol } from "./symbol";

export function CirclesScreen({
  circles,
  onOpenJournal,
  onCirclesChanged,
  previewMembers,
}: Readonly<{
  circles: readonly CircleMembership[];
  onOpenJournal: (circleId: string) => void;
  onCirclesChanged: () => Promise<void> | void;
  /** Skips the roster request when a preview already has members. */
  previewMembers?: ReadonlyMap<string, readonly CirclePerson[]>;
}>) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const visible = postableCircles(circles);
  const sourceId = createCircleSourceId(circles);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [members, setMembers] = useState<ReadonlyMap<string, readonly CirclePerson[]>>(
    () => previewMembers ?? new Map(),
  );
  const rosterKey = visible.map((circle) => circle.circleId).join(",");
  const [loadedKey, setLoadedKey] = useState(previewMembers ? "preview" : "");
  const loadingMembers = previewMembers == null && rosterKey.length > 0 && loadedKey !== rosterKey;
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const detail = visible.find((circle) => circle.circleId === detailId) ?? null;

  useEffect(() => {
    if (previewMembers) return;
    const supabase = getSupabase();
    const ids = rosterKey ? rosterKey.split(",") : [];
    if (!supabase || ids.length === 0) return;
    let active = true;
    void loadRosters(supabase, ids).then((loaded) => {
      if (!active) return;
      setMembers(new Map([...loaded].map(([id, roster]) => [id, roster.people])));
      setLoadedKey(rosterKey);
    });
    return () => {
      active = false;
    };
  }, [previewMembers, rosterKey]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.paper }]}>
      <CircleList
        circles={visible}
        members={members}
        loading={loadingMembers}
        canCreate={Boolean(sourceId)}
        topInset={insets.top}
        onOpen={setDetailId}
        onCreate={() => setCreating(true)}
      />
      {detail ? (
        <CircleDetail
          circle={detail}
          title={detail.name}
          people={members.get(detail.circleId) ?? []}
          loading={loadingMembers}
          onBack={() => setDetailId(null)}
          onOpenJournal={() => onOpenJournal(detail.circleId)}
          onInvite={detail.role === "organizer" ? () => setInviting(true) : null}
        />
      ) : null}
      {creating && sourceId ? (
        <CreateCircleSheet
          sourceName={visible.find((circle) => circle.circleId === sourceId)?.name ?? ""}
          onClose={() => setCreating(false)}
          onCreate={async (name) => {
            const supabase = getSupabase();
            if (!supabase) return "That circle could not be created.";
            const result = await createCircle(supabase, name, sourceId);
            if (!result.ok) return result.message;
            await onCirclesChanged();
            setCreating(false);
            setDetailId(result.circleId);
            return null;
          }}
        />
      ) : null}
      {inviting && detail ? (
        <InviteSendSheet
          circles={circles}
          viewedCircleId={detail.circleId}
          onClose={() => setInviting(false)}
        />
      ) : null}
    </View>
  );
}

function CircleList({
  circles,
  members,
  loading,
  canCreate,
  topInset,
  onOpen,
  onCreate,
}: Readonly<{
  circles: readonly CircleMembership[];
  members: ReadonlyMap<string, readonly CirclePerson[]>;
  loading: boolean;
  canCreate: boolean;
  topInset: number;
  onOpen: (circleId: string) => void;
  onCreate: () => void;
}>) {
  const { colors } = useAppTheme();
  const retro = colors.appearance === "retro";
  const radius = retro ? 2 : 10;
  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: topInset + 8, paddingBottom: 120, paddingHorizontal: 16 }}
    >
      <Text style={[face(colors, 700), styles.largeTitle, { color: colors.ink }]}>Circles</Text>
      {loading && circles.length > 0 ? (
        <ActivityIndicator color={colors.ink} style={{ marginTop: 24 }} />
      ) : null}
      {circles.length === 0 ? (
        <Text style={[face(colors, 400), styles.empty, { color: colors.muted }]}>
          Circles you belong to will show up here.
        </Text>
      ) : (
        <View style={[styles.group, { backgroundColor: colors.cream, borderRadius: radius }]}>
          {circles.map((circle, index) => {
            const count = members.get(circle.circleId)?.length;
            return (
              <Pressable
                key={circle.circleId}
                accessibilityRole="button"
                accessibilityLabel={`Open ${circle.name}`}
                onPress={() => onOpen(circle.circleId)}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 ? { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth } : null,
                  pressed ? { backgroundColor: colors.selectionFill } : null,
                ]}
              >
                <View style={styles.rowCopy}>
                  <Text style={[face(colors, 400), styles.rowTitle, { color: colors.ink }]} numberOfLines={1}>
                    {circle.name}
                  </Text>
                  {count != null ? (
                    <Text style={[face(colors, 400), styles.rowSubtitle, { color: colors.muted }]}>
                      {peopleCountLabel(count)}
                    </Text>
                  ) : null}
                </View>
                <Symbol name="chevron.right" size={14} color={colors.muted} />
              </Pressable>
            );
          })}
        </View>
      )}
      {canCreate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a circle"
          onPress={onCreate}
          style={({ pressed }) => [
            styles.group,
            styles.row,
            { backgroundColor: colors.cream, borderRadius: radius, marginTop: 20 },
            pressed ? { backgroundColor: colors.selectionFill } : null,
          ]}
        >
          <Symbol name="plus" size={20} color={colors.action} />
          <Text style={[face(colors, 400), styles.rowTitle, { color: colors.action, marginLeft: 10 }]}>
            Create a circle
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function CircleDetail({
  circle,
  title,
  people,
  loading,
  onBack,
  onOpenJournal,
  onInvite,
}: Readonly<{
  circle: CircleMembership;
  title: string;
  people: readonly CirclePerson[];
  loading: boolean;
  onBack: () => void;
  onOpenJournal: () => void;
  onInvite: (() => void) | null;
}>) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [slide] = useState(() => new Animated.Value(width));
  const retro = colors.appearance === "retro";
  const radius = retro ? 2 : 10;
  useEffect(() => {
    Animated.timing(slide, { toValue: 0, duration: 280, useNativeDriver: true }).start();
  }, [slide]);

  function close() {
    Animated.timing(slide, { toValue: width, duration: 220, useNativeDriver: true }).start(({ finished }) => {
      if (finished) onBack();
    });
  }

  return (
    <Animated.View
      style={[
        styles.detail,
        { backgroundColor: colors.paper, transform: [{ translateX: slide }] },
      ]}
    >
      <View style={[styles.navBar, { paddingTop: insets.top }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Circles" onPress={close} style={styles.back}>
          <Text style={[face(colors, 400), { color: colors.action, fontSize: 17 }]}>Circles</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 120, paddingHorizontal: 16 }}>
        <Text style={[face(colors, 700), styles.largeTitle, { color: colors.ink }]}>{title || circle.name}</Text>
        <View style={[styles.group, { backgroundColor: colors.cream, borderRadius: radius }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${title || circle.name} journal`}
            onPress={onOpenJournal}
            style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.selectionFill } : null]}
          >
            <View style={styles.rowCopy}>
              <Text style={[face(colors, 400), styles.rowTitle, { color: colors.ink }]}>Open journal</Text>
              <Text style={[face(colors, 400), styles.rowSubtitle, { color: colors.muted }]}>
                The shared journal
              </Text>
            </View>
            <Symbol name="chevron.right" size={14} color={colors.muted} />
          </Pressable>
        </View>
        <Text
          style={[
            face(colors, 600, "record"),
            styles.section,
            { color: colors.muted, letterSpacing: tracking(11, 0.08) },
          ]}
        >
          Members
        </Text>
        <View style={[styles.group, { backgroundColor: colors.cream, borderRadius: radius }]}>
          {loading && people.length === 0 ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.ink} />
            </View>
          ) : people.length === 0 ? (
            <View style={styles.row}>
              <Text style={[face(colors, 400), { color: colors.muted, fontSize: 16 }]}>No members yet</Text>
            </View>
          ) : (
            people.map((person, index) => {
              const you = person.id === circle.personId;
              return (
                <View
                  key={person.id}
                  style={[
                    styles.row,
                    index > 0 ? { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth } : null,
                  ]}
                >
                  <View
                    style={[
                      styles.avatar,
                      {
                        backgroundColor: retro ? colors.action : dotColor(person.accent, colors),
                        borderRadius: retro ? 2 : 18,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        face(colors, 700),
                        { color: retro ? colors.actionInk : dotInk(person.accent, colors), fontSize: 15 },
                      ]}
                    >
                      {person.initial}
                    </Text>
                  </View>
                  <Text style={[face(colors, 400), styles.rowTitle, { color: colors.ink, flex: 1 }]} numberOfLines={1}>
                    {you ? `${person.name} · You` : person.name}
                  </Text>
                </View>
              );
            })
          )}
        </View>
        {onInvite ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Invite someone to ${title || circle.name}`}
            onPress={onInvite}
            style={({ pressed }) => [
              styles.group,
              styles.row,
              { backgroundColor: colors.cream, borderRadius: radius, marginTop: 20 },
              pressed ? { backgroundColor: colors.selectionFill } : null,
            ]}
          >
            <Symbol name="person.badge.plus" size={20} color={colors.action} />
            <Text style={[face(colors, 400), styles.rowTitle, { color: colors.action, marginLeft: 10 }]}>
              Invite someone
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Animated.View>
  );
}

function CreateCircleSheet({
  sourceName,
  onClose,
  onCreate,
}: Readonly<{
  sourceName: string;
  onClose: () => void;
  onCreate: (name: string) => Promise<string | null>;
}>) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalid = circleNameError(name);
  const retro = colors.appearance === "retro";

  async function submit() {
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    const message = await onCreate(name);
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.sheetScrim, { backgroundColor: colors.scheme === "light" ? "rgba(32,39,33,0.42)" : "rgba(0,5,3,0.72)" }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable accessibilityLabel="Close" style={styles.sheetScrimTap} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.cream,
              paddingBottom: Math.max(16, insets.bottom),
              borderTopLeftRadius: retro ? 2 : 14,
              borderTopRightRadius: retro ? 2 : 14,
            },
          ]}
        >
          <View style={styles.sheetBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onClose} style={styles.sheetSide}>
              <Text style={[face(colors, 400), { color: colors.ink, fontSize: 17 }]}>Cancel</Text>
            </Pressable>
            <Text style={[face(colors, 650), styles.sheetTitle, { color: colors.ink }]}>Create a circle</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create"
              disabled={Boolean(invalid) || busy}
              onPress={() => void submit()}
              style={[styles.sheetSide, styles.sheetEnd]}
            >
              <Text style={[face(colors, 700), { color: colors.action, fontSize: 17, opacity: invalid || busy ? 0.4 : 1 }]}>
                {busy ? "Creating…" : "Create"}
              </Text>
            </Pressable>
          </View>
          <Text style={[face(colors, 400), styles.helper, { color: colors.muted }]}>
            A circle is a group of people who share one journal. You can invite people after it’s created.
            {sourceName ? ` Your name is copied from ${sourceName}.` : ""}
          </Text>
          <Text
            style={[
              face(colors, 600, "record"),
              styles.fieldLabel,
              { color: colors.muted, letterSpacing: tracking(11, 0.08) },
            ]}
          >
            Name
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            accessibilityLabel="Circle name"
            placeholder="Family"
            placeholderTextColor={colors.faint}
            autoFocus
            style={[
              styles.input,
              face(colors, 400),
              {
                color: colors.ink,
                borderColor: colors.hairline,
                backgroundColor: colors.surface,
                borderRadius: retro ? 2 : 8,
              },
            ]}
          />
          {error ? <Text style={[face(colors, 400), { color: colors.clay }]}>{error}</Text> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  largeTitle: { fontSize: 34, lineHeight: 41, marginBottom: 16, marginTop: 4 },
  empty: { fontSize: 16, lineHeight: 22, marginTop: 8 },
  group: { overflow: "hidden" },
  row: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  rowCopy: { flex: 1, paddingVertical: 8 },
  rowTitle: { fontSize: 17, lineHeight: 22 },
  rowSubtitle: { fontSize: 13, lineHeight: 18, marginTop: 1 },
  section: {
    fontSize: 11,
    textTransform: "uppercase",
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 16,
  },
  avatar: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  detail: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  navBar: { minHeight: 44, justifyContent: "flex-end" },
  back: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, alignSelf: "flex-start" },
  sheetScrim: { flex: 1, justifyContent: "flex-end" },
  sheetScrimTap: { flexGrow: 1 },
  sheet: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  sheetBar: { minHeight: 44, flexDirection: "row", alignItems: "center" },
  sheetSide: { minWidth: 72, minHeight: 44, justifyContent: "center" },
  sheetEnd: { alignItems: "flex-end" },
  sheetTitle: { flex: 1, textAlign: "center", fontSize: 17 },
  helper: { fontSize: 15, lineHeight: 21 },
  fieldLabel: { fontSize: 11, textTransform: "uppercase", marginTop: 8 },
  input: { minHeight: 44, borderWidth: 1, paddingHorizontal: 12, fontSize: 17 },
});
