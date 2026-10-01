import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Alert, Animated, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { MenuView } from "@expo/ui/community/menu";

import type { TimelineMoment } from "../lib/journal";
import { momentOverflowActions } from "../lib/moment-menu";
import { trashWrittenMoment, updateWrittenMoment } from "../lib/posts";
import { getSupabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { face, tracking } from "../lib/tokens";
import { useChromeDismiss } from "./sheet-drag";

export const MomentChangeContext = createContext<{
  onChange: (moment: TimelineMoment) => void;
  onRemove: (id: string) => void;
}>({
  onChange: () => undefined,
  onRemove: () => undefined,
});

export function MomentOverflow({
  moment,
  color,
}: Readonly<{
  moment: TimelineMoment;
  color: string;
}>) {
  const { onChange, onRemove } = useContext(MomentChangeContext);
  const { colors } = useAppTheme();
  const actions = moment.canChange ? momentOverflowActions(moment.kind) : [];
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(moment.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const sheetHeight = useRef(320);
  const onCommit = useRef<Parameters<typeof useChromeDismiss>[0]["onCommit"]["current"]>(() => undefined);
  const { translateY, panHandlers } = useChromeDismiss({ sheetHeight, onCommit });

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
    onCommit.current = ({ springBack, dismiss }) => {
      const close = () => {
        Keyboard.dismiss();
        setEditing(false);
      };
      if (body.trim() === moment.body.trim()) {
        dismiss(close);
        return;
      }
      springBack();
      Alert.alert("Discard these edits?", undefined, [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: close },
      ]);
    };
  });

  if (actions.length === 0) return null;

  function requestClose() {
    if (body.trim() === moment.body.trim()) {
      Keyboard.dismiss();
      setEditing(false);
      return;
    }
    Alert.alert("Discard these edits?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => { Keyboard.dismiss(); setEditing(false); } },
    ]);
  }

  function remove() {
    Alert.alert("Delete this moment?", undefined, [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          const supabase = getSupabase();
          if (!supabase) return;
          void trashWrittenMoment(supabase, moment.id, moment.revision).then((result) => {
            if (!result.ok) {
              Alert.alert(result.message);
              return;
            }
            onRemove(moment.id);
          });
        },
      },
    ]);
  }

  async function save() {
    const supabase = getSupabase();
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    const result = await updateWrittenMoment(supabase, {
      momentId: moment.id,
      revision: moment.revision,
      body,
      occurredOn: moment.occurredOn,
      occurredAt: moment.occurredAt,
      occurredTimezone: moment.occurredTimezone,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onChange({ ...moment, body: body.trim(), revision: result.revision ?? moment.revision });
    setEditing(false);
  }

  const glyph = (
    <View style={styles.glyph}>
      <Text
        style={[
          face(colors, 400),
          { color, fontSize: 15, lineHeight: 15, letterSpacing: tracking(15, -0.18) },
        ]}
      >
        •••
      </Text>
    </View>
  );

  return (
    <>
      {Platform.OS === "ios" ? (
      <MenuView
        actions={actions.map((id) =>
          id === "edit"
            ? { id, title: "Edit" }
            : { id, title: "Delete", attributes: { destructive: true } },
        )}
        onPressAction={(event) => {
          if (event.nativeEvent.event === "edit") {
            setBody(moment.body);
            setError(null);
            setEditing(true);
            return;
          }
          if (event.nativeEvent.event === "delete") remove();
        }}
        style={styles.hit}
      >
        {glyph}
      </MenuView>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Moment options"
          onPress={() =>
            Alert.alert("Moment options", undefined, [
              ...(actions.includes("edit")
                ? [{ text: "Edit", onPress: () => { setBody(moment.body); setEditing(true); } }]
                : []),
              { text: "Delete", style: "destructive" as const, onPress: remove },
              { text: "Cancel", style: "cancel" as const },
            ])
          }
          style={styles.hit}
        >
          {glyph}
        </Pressable>
      )}
      {editing ? (
        <Modal transparent animationType="slide" onRequestClose={requestClose}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.editScrim, { backgroundColor: colors.scheme === "light" ? "rgba(32,39,33,0.42)" : "rgba(0,5,3,0.72)" }]}
          >
            <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={requestClose} />
            <Animated.View
              onLayout={(event) => {
                sheetHeight.current = event.nativeEvent.layout.height;
              }}
              style={[
                styles.editSheet,
                {
                  backgroundColor: colors.paper,
                  borderColor: colors.hairline,
                  paddingBottom: keyboardOpen ? 8 : 16,
                  transform: [{ translateY }],
                },
              ]}
            >
              <View {...panHandlers}>
                <View style={styles.handleHit} accessibilityLabel="Drag down to close">
                  <View style={[styles.handle, { backgroundColor: colors.scheme === "light" ? "#c5c9c6" : "#526158" }]} />
                </View>
                <View style={styles.editBar}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={requestClose}>
                    <Text style={[face(colors, 400), { color: colors.ink, fontSize: 17 }]}>Cancel</Text>
                  </Pressable>
                  <Text style={[face(colors, 650), { color: colors.ink, fontSize: 17 }]}>Edit</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Save" disabled={busy || !body.trim()} onPress={() => void save()}>
                    <Text style={[face(colors, 700), { color: colors.action, fontSize: 17, opacity: body.trim() ? 1 : 0.4 }]}>{busy ? "Saving…" : "Save"}</Text>
                  </Pressable>
                </View>
              </View>
              <TextInput
                value={body}
                onChangeText={setBody}
                multiline
                autoFocus
                accessibilityLabel="Entry"
                style={[face(colors, 400, "serif"), styles.editInput, { color: colors.ink, borderColor: colors.hairline }]}
              />
              {error ? <Text style={[face(colors, 400), { color: colors.clay }]}>{error}</Text> : null}
            </Animated.View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
    </>
  );
}

const styles = {
  hit: {
    position: "absolute" as const,
    right: 0,
    top: "50%" as const,
    width: 44,
    height: 44,
    marginTop: -22,
  },
  glyph: {
    width: 44,
    height: 44,
    alignItems: "flex-end" as const,
    justifyContent: "center" as const,
  },
  editScrim: { flex: 1, justifyContent: "flex-end" as const },
  editSheet: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 0, gap: 12, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  handleHit: { alignItems: "center" as const, paddingTop: 10, paddingBottom: 6 },
  handle: { width: 38, height: 4, borderRadius: 999 },
  editBar: { minHeight: 44, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  editInput: { minHeight: 120, maxHeight: 260, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 17, lineHeight: 25 },
};
