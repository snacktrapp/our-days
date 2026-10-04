import { createContext, useContext } from "react";
import { Alert, Platform, Pressable, View } from "react-native";

import type { TimelineMoment } from "../lib/journal";
import { momentOverflowActions } from "../lib/moment-menu";
import { trashWrittenMoment } from "../lib/posts";
import { getSupabase } from "../lib/supabase";
import { IosMenuTrigger } from "./ios-menu-trigger";

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
      <MoreDots color={color} />
    </View>
  );

  return Platform.OS === "ios" ? (
    <IosMenuTrigger
      style={styles.hit}
      label="Moment options"
      items={[
        ...(actions.includes("edit") ? [{ id: "edit", title: "Edit", onPress: () => onEdit(moment) }] : []),
        { id: "delete", title: "Delete", destructive: true, onPress: remove },
      ]}
    >
      {glyph}
    </IosMenuTrigger>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Moment options"
      onPress={() =>
        Alert.alert("Moment options", undefined, [
          ...(actions.includes("edit") ? [{ text: "Edit", onPress: () => onEdit(moment) }] : []),
          { text: "Delete", style: "destructive" as const, onPress: remove },
          { text: "Cancel", style: "cancel" as const },
        ])
      }
      style={styles.hit}
    >
      {glyph}
    </Pressable>
  );
}

/**
 * Three round dots, iOS style. `size` is the dot diameter; the gap matches it.
 * Posts use 4pt dots, comments 3pt, so both read as the same control.
 */
export function MoreDots({ color, size = 4 }: Readonly<{ color: string; size?: number }>) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: size }}>
      {[0, 1, 2].map((dot) => (
        <View
          key={dot}
          style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }}
        />
      ))}
    </View>
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
    // Above the caption below, which would otherwise cover the lower half.
    zIndex: 2,
  },
  glyph: {
    width: 44,
    height: 44,
    alignItems: "flex-end" as const,
    justifyContent: "center" as const,
    paddingRight: 2,
    // Not fully transparent, so every point of the square takes the touch.
    backgroundColor: "rgba(0,0,0,0.002)",
  },
};
