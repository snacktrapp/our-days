import { createContext, useContext } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { MenuView } from "@expo/ui/community/menu";

import type { TimelineMoment } from "../lib/journal";
import { momentOverflowActions } from "../lib/moment-menu";
import { trashWrittenMoment } from "../lib/posts";
import { getSupabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { face, tracking } from "../lib/tokens";

export const MomentChangeContext = createContext<{
  onChange: (moment: TimelineMoment) => void;
  onRemove: (id: string) => void;
  /** Opens the edit sheet (the Add sheet in edit mode) for this post. */
  onEdit: (moment: TimelineMoment) => void;
}>({
  onChange: () => undefined,
  onRemove: () => undefined,
  onEdit: () => undefined,
});

export function MomentOverflow({
  moment,
  color,
}: Readonly<{
  moment: TimelineMoment;
  color: string;
}>) {
  const { onRemove, onEdit } = useContext(MomentChangeContext);
  const { colors } = useAppTheme();
  const actions = moment.canChange ? momentOverflowActions(moment.kind) : [];

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
            onEdit(moment);
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
                ? [{ text: "Edit", onPress: () => onEdit(moment) }]
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
};
