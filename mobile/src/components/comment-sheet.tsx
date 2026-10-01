import { useEffect, useRef, useState } from "react";
import { BlurView } from "expo-blur";
import {
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  applyMentionTextChange,
  filterMentionCandidates,
  insertMention,
  mentionQueryAt,
  type DraftMention,
} from "../../../src/features/mentions/mention-draft";
import type { MentionCandidate, MentionWrite } from "../lib/conversation";
import { useAppTheme } from "../lib/theme";
import { dotColor, face } from "../lib/tokens";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { composerKeyboardDismissMode } from "./keyboard-form";
import { useChromeDismiss } from "./sheet-drag";

export function CommentSheet({
  title,
  context,
  initialBody,
  initialMentions,
  editing,
  members,
  pending,
  error,
  onDismiss,
  onSubmit,
  onDelete,
}: Readonly<{
  title: string;
  context: string;
  initialBody: string;
  initialMentions: readonly DraftMention[];
  editing: boolean;
  members: readonly MentionCandidate[];
  pending: boolean;
  error: string | null;
  onDismiss: () => void;
  onSubmit: (body: string, mentions: readonly MentionWrite[]) => void;
  onDelete?: () => void;
}>) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [body, setBody] = useState(initialBody);
  const [mentions, setMentions] = useState<readonly DraftMention[]>(initialMentions);
  const [cursor, setCursor] = useState(initialBody.length);
  const query = mentionQueryAt(body, cursor, mentions);
  const suggestions = query && members.length > 0 ? filterMentionCandidates(members, query.query).slice(0, 6) : [];
  const onCommit = useRef<Parameters<typeof useChromeDismiss>[0]["onCommit"]["current"]>(() => undefined);
  const posting = useRef(false);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (!pending) posting.current = false;
  }, [pending]);

  // An edit only needs a confirm when the text changed; a new comment when it has any text.
  const dirty = body.trim() !== initialBody.trim();

  function requestClose() {
    if (pending) return;
    if (!dirty) {
      onDismiss();
      return;
    }
    Alert.alert(editing ? "Discard these edits?" : "Discard this comment?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onDismiss },
    ]);
  }

  useEffect(() => {
    onCommit.current = ({ springBack, dismiss }) => {
      if (pending) {
        springBack();
        return;
      }
      if (!dirty) {
        dismiss(() => {
          Keyboard.dismiss();
          onDismiss();
        });
        return;
      }
      springBack();
      requestClose();
    };
  });

  const { translateY, sheetProps, chromeProps } = useChromeDismiss({ onCommit });

  const retro = colors.appearance === "retro";
  const light = colors.scheme === "light" && !retro;
  const scrimColor = retro ? "#100d0c" : light ? "rgba(32,39,33,0.42)" : "rgba(0,5,3,0.72)";
  const canPost = !pending && body.trim().length > 0;

  function submit() {
    if (posting.current || !canPost) return;
    posting.current = true;
    onSubmit(body.trim(), mentions);
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={requestClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={[styles.scrim, { backgroundColor: scrimColor }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {Platform.OS === "web" ? null : (
          <BlurView intensity={40} tint={light ? "light" : "dark"} style={StyleSheet.absoluteFill} />
        )}
        <Pressable
          accessibilityLabel="Close"
          style={styles.scrimTap}
          onPress={() => (Keyboard.isVisible() ? Keyboard.dismiss() : requestClose())}
        />
        <Animated.View
          {...sheetProps}
          style={[
            styles.sheet,
            {
              backgroundColor: retro ? colors.cream : colors.paper,
              borderColor: colors.hairline,
              borderTopLeftRadius: retro ? 2 : 14,
              borderTopRightRadius: retro ? 2 : 14,
              paddingBottom: keyboardOpen ? 8 : Math.max(21, insets.bottom),
              transform: [{ translateY }],
            },
          ]}
        >
          <View {...chromeProps}>
            <View style={styles.handleHit} accessibilityRole="adjustable" accessibilityLabel="Drag down to close">
              <View style={[styles.handle, { backgroundColor: retro ? "#6f655b" : "#526158" }]} />
            </View>
            <Text style={[styles.title, face(colors, 650), { color: colors.ink }]}>{title}</Text>
          </View>
          <Text
            numberOfLines={2}
            style={[face(colors, 400), styles.context, { color: colors.muted, fontSize: 13, lineHeight: 18 }]}
          >
            {context}
          </Text>
          {suggestions.length > 0 ? (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="always"
              keyboardDismissMode={composerKeyboardDismissMode}
              showsHorizontalScrollIndicator={false}
              style={styles.chipRow}
              contentContainerStyle={styles.chipRowContent}
              accessibilityLabel="Mention a circle member"
            >
              {suggestions.map((member) => (
                <Pressable
                  key={member.userId}
                  accessibilityRole="button"
                  accessibilityLabel={member.name}
                  onPress={() => {
                    const active = mentionQueryAt(body, cursor, mentions);
                    if (!active) return;
                    const inserted = insertMention(body, cursor, active.start, member, mentions);
                    setBody(inserted.text);
                    setMentions(inserted.mentions);
                    setCursor(inserted.cursor);
                  }}
                  style={[
                    styles.chip,
                    retro
                      ? { borderColor: colors.action, borderRadius: 999, backgroundColor: withAlpha(colors.action, 0.14) }
                      : null,
                  ]}
                >
                  <View
                    style={[
                      styles.chipMark,
                      {
                        backgroundColor: retro ? colors.action : dotColor(member.accent, colors),
                        borderRadius: retro ? 2 : 14,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        face(colors, 700),
                        styles.chipInitial,
                        { color: light ? "#ffffff" : colors.paper },
                      ]}
                    >
                      {member.initial}
                    </Text>
                  </View>
                  <Text
                    style={[
                      face(colors, 500),
                      { color: retro ? colors.ink : colors.muted, fontSize: retro ? 15 : 11 },
                    ]}
                  >
                    {member.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <View
            style={[
              styles.pill,
              { backgroundColor: colors.cream, borderColor: colors.hairline, marginTop: suggestions.length > 0 ? 8 : 12 },
            ]}
          >
            {editing && onDelete ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete comment"
                disabled={pending}
                onPress={onDelete}
                style={styles.delete}
              >
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12"
                    stroke={colors.muted}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
            ) : null}
            <TextInput
              value={body}
              autoFocus
              placeholder="A memory, detail, or reply…"
              placeholderTextColor={colors.faint}
              multiline
              numberOfLines={1}
              maxLength={1000}
              editable={!pending}
              accessibilityLabel={editing ? "Edit your note" : "Add a family note"}
              onChangeText={(next) => {
                const applied = applyMentionTextChange(body, next, mentions);
                setBody(applied.text);
                setMentions(applied.mentions);
                setCursor(applied.cursor);
              }}
              onSelectionChange={(event) => {
                setCursor(event.nativeEvent.selection.end);
              }}
              style={[styles.input, face(colors, 400), { color: colors.ink }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={pending ? "Saving…" : editing ? "Save" : "Post"}
              disabled={!canPost}
              onPress={submit}
              onPressIn={submit}
              style={[styles.send, { backgroundColor: colors.action, opacity: canPost ? 1 : 0.38 }]}
            >
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M12 19V6M6.5 11.5 12 6l5.5 5.5"
                  stroke={canPost ? colors.actionInk : "#ffffff"}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
          </View>
          {error ? (
            <Text style={[face(colors, 400), styles.error, { color: colors.clay }]}>{error}</Text>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function withAlpha(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return hex;
  const n = Number.parseInt(value, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    ...(Platform.OS === "web" ? { backdropFilter: "blur(8px)" } : null),
  },
  scrimTap: { flex: 1 },
  // Web .comment-sheet: 14px top corners, 22/20/10 bar, centered 17px title.
  sheet: {
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  handleHit: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 999,
  },
  title: {
    marginTop: 4,
    paddingHorizontal: 20,
    fontSize: 17,
    lineHeight: 20.4,
    letterSpacing: -0.425,
    textAlign: "center",
  },
  context: {
    marginTop: 16,
    paddingHorizontal: 20,
    fontSize: 11,
    lineHeight: 16.5,
  },
  chipRow: { marginTop: 12, flexGrow: 0 },
  chipRowContent: { paddingHorizontal: 20, gap: 6 },
  chip: {
    height: 44,
    paddingLeft: 8,
    paddingRight: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chipMark: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  chipInitial: { fontSize: 13, lineHeight: 15 },
  pill: {
    marginTop: 12,
    marginHorizontal: 20,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  delete: { width: 36, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    maxHeight: 100,
    fontSize: 16,
    lineHeight: 20,
    paddingTop: 12,
    paddingBottom: 12,
    paddingRight: 8,
    ...(Platform.OS === "web" ? { outlineWidth: 0 } : null),
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  error: { fontSize: 12, marginTop: 8, paddingHorizontal: 20 },
});
