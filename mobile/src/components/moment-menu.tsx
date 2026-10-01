import { createContext, useContext, useState } from "react";
import { Alert, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { MenuView } from "@expo/ui/community/menu";

import type { TimelineMoment } from "../lib/journal";
import { momentOverflowActions } from "../lib/moment-menu";
import { trashWrittenMoment, updateWrittenMoment } from "../lib/posts";
import { getSupabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { face, tracking } from "../lib/tokens";

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
  if (actions.length === 0) return null;

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
        <Modal transparent animationType="slide" onRequestClose={() => setEditing(false)}>
          <View style={[styles.editScrim, { backgroundColor: colors.scheme === "light" ? "rgba(32,39,33,0.42)" : "rgba(0,5,3,0.72)" }]}>
            <View style={[styles.editSheet, { backgroundColor: colors.paper, borderColor: colors.hairline }]}>
              <View style={styles.editBar}>
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={() => setEditing(false)}>
                  <Text style={[face(colors, 400), { color: colors.ink, fontSize: 17 }]}>Cancel</Text>
                </Pressable>
                <Text style={[face(colors, 650), { color: colors.ink, fontSize: 17 }]}>Edit</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Post" disabled={busy} onPress={() => void save()}>
                  <Text style={[face(colors, 700), { color: colors.action, fontSize: 17 }]}>{busy ? "Saving…" : "Post"}</Text>
                </Pressable>
              </View>
              <TextInput
                value={body}
                onChangeText={setBody}
                multiline
                accessibilityLabel="Entry"
                style={[face(colors, 400, "serif"), styles.editInput, { color: colors.ink, borderColor: colors.hairline }]}
              />
              {error ? <Text style={[face(colors, 400), { color: colors.clay }]}>{error}</Text> : null}
            </View>
          </View>
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
  editSheet: { borderTopWidth: 1, padding: 16, gap: 12, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  editBar: { minHeight: 44, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  editInput: { minHeight: 120, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 17, lineHeight: 25 },
};
