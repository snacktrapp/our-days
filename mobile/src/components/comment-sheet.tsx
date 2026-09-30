import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
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
import { face } from "../lib/tokens";

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
  const [body, setBody] = useState(initialBody);
  const [mentions, setMentions] = useState<readonly DraftMention[]>(initialMentions);
  const [cursor, setCursor] = useState(initialBody.length);
  const query = mentionQueryAt(body, cursor, mentions);
  const suggestions = query && members.length > 0 ? filterMentionCandidates(members, query.query).slice(0, 6) : [];

  function requestClose() {
    if (pending) return;
    if (!body.trim()) {
      onDismiss();
      return;
    }
    Alert.alert("Discard this comment?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onDismiss },
    ]);
  }

  return (
    <KeyboardAvoidingView
      style={styles.scrim}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Pressable accessibilityLabel="Close" style={styles.scrimTap} onPress={requestClose} />
      <View style={[styles.sheet, { backgroundColor: colors.paper, borderColor: colors.hairline }]}>
        <View style={[styles.handle, { backgroundColor: colors.scheme === "dark" ? "#526158" : colors.line }]} />
        <Text style={[styles.title, face(colors, 650), { color: colors.ink }]}>{title}</Text>
        <Text style={[face(colors, 400, "record"), styles.context, { color: colors.muted }]}>{context}</Text>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          <View style={styles.fieldRow}>
            {editing && onDelete ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete comment"
                disabled={pending}
                onPress={onDelete}
                style={styles.delete}
              >
                <Text style={{ color: colors.muted, fontSize: 18 }}>⌫</Text>
              </Pressable>
            ) : null}
            <TextInput
              value={body}
              placeholder="A memory, detail, or reply…"
              placeholderTextColor={colors.faint}
              multiline
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
              style={[
                styles.input,
                face(colors, 400),
                { color: colors.ink, borderColor: colors.hairline, backgroundColor: colors.surface },
              ]}
            />
          </View>
          {suggestions.map((member) => (
            <Pressable
              key={member.userId}
              accessibilityRole="button"
              onPress={() => {
                const active = mentionQueryAt(body, cursor, mentions);
                if (!active) return;
                const inserted = insertMention(body, cursor, active.start, member, mentions);
                setBody(inserted.text);
                setMentions(inserted.mentions);
                setCursor(inserted.cursor);
              }}
              style={styles.suggestion}
            >
              <Text style={[face(colors, 500), { color: colors.ink }]}>{member.name}</Text>
            </Pressable>
          ))}
          {error ? <Text style={[face(colors, 400), { color: colors.clay }]}>{error}</Text> : null}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          disabled={pending || !body.trim()}
          onPress={() => onSubmit(body.trim(), mentions)}
          style={[styles.post, { backgroundColor: colors.action, opacity: pending || !body.trim() ? 0.5 : 1 }]}
        >
          <Text style={[face(colors, 650), { color: colors.actionInk }]}>
            {pending ? "Saving…" : editing ? "Save" : "Post"}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 50,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,5,3,0.72)",
  },
  scrimTap: { flex: 1 },
  sheet: {
    borderTopWidth: 1,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingTop: 8,
    paddingBottom: 16,
    maxHeight: "70%",
  },
  handle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 999,
    marginBottom: 8,
  },
  title: { fontSize: 17, lineHeight: 22, paddingHorizontal: 20 },
  context: { fontSize: 12, paddingHorizontal: 20, marginTop: 4 },
  body: { paddingHorizontal: 20, paddingTop: 12, gap: 8 },
  fieldRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  delete: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    minHeight: 88,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  suggestion: { minHeight: 44, justifyContent: "center" },
  post: {
    marginHorizontal: 20,
    marginTop: 8,
    minHeight: 48,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
});
