import { createContext, useContext, useState, type ReactNode } from "react";
import { Alert, Platform, Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import type { FeedNote, TimelineMoment } from "../lib/journal";
import {
  blockActionTitle,
  commentOverflowActions,
  momentOverflowActions,
  type OverflowAction,
} from "../lib/moment-menu";
import { trashWrittenMoment } from "../lib/posts";
import { getSupabase } from "../lib/supabase";
import { BlockSheet, ReportSheet } from "./safety-sheets";
import { IosMenuTrigger, type MenuItem } from "./ios-menu-trigger";

export const MomentChangeContext = createContext<{
  onChange: (moment: TimelineMoment) => void;
  onRemove: (id: string) => void;
  /** Opens the edit sheet (the Add sheet in edit mode) for this post. */
  onEdit: (moment: TimelineMoment) => void;
  onHideAuthor: (membershipId: string) => void;
  viewerMembershipIds: readonly string[];
  hiddenAuthorIds: readonly string[];
}>({
  onChange: () => undefined,
  onRemove: () => undefined,
  onEdit: () => undefined,
  onHideAuthor: () => undefined,
  viewerMembershipIds: [],
  hiddenAuthorIds: [],
});

export function MomentOverflow({
  moment,
  color,
}: Readonly<{
  moment: TimelineMoment;
  color: string;
}>) {
  const { onRemove, onEdit, onHideAuthor, viewerMembershipIds } = useContext(MomentChangeContext);
  const actions = momentOverflowActions({
    kind: moment.kind,
    canChange: moment.canChange,
    pending: Boolean(moment.pending),
    authorMembershipId: moment.authorMembershipId,
    viewerMembershipIds,
  });
  const authorName = moment.recorderName || moment.personName;

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

  return (
    <ContentMenu
      label="Moment options"
      style={styles.hit}
      actions={actions}
      blockTitle={blockActionTitle(authorName)}
      reportKind="moment"
      targetId={moment.id}
      authorMembershipId={moment.authorMembershipId ?? ""}
      authorName={authorName}
      onEdit={() => onEdit(moment)}
      onRemove={remove}
      onReported={() => onRemove(moment.id)}
      onBlocked={() => {
        if (moment.authorMembershipId) onHideAuthor(moment.authorMembershipId);
      }}
    >
      <MoreGlyph color={color} />
    </ContentMenu>
  );
}

export function CommentOverflow({
  note,
  color,
  disabled,
  onEdit,
  onRemove,
  onReported,
  style,
}: Readonly<{
  note: FeedNote;
  color: string;
  disabled?: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onReported: () => void;
  style: StyleProp<ViewStyle>;
}>) {
  const { onHideAuthor, viewerMembershipIds } = useContext(MomentChangeContext);
  const actions = commentOverflowActions({
    canChange: note.canChange,
    authorMembershipId: note.authorMembershipId,
    viewerMembershipIds,
  });
  if (actions.length === 0) return null;
  return (
    <ContentMenu
      label="Comment options"
      style={style}
      actions={actions}
      blockTitle={blockActionTitle(note.authorName)}
      reportKind="note"
      targetId={note.id}
      authorMembershipId={note.authorMembershipId ?? ""}
      authorName={note.authorName}
      disabled={disabled}
      deleteTitle="Remove"
      onEdit={onEdit}
      onRemove={onRemove}
      onReported={onReported}
      onBlocked={() => {
        if (note.authorMembershipId) onHideAuthor(note.authorMembershipId);
      }}
    >
      <MoreDots color={color} size={3} />
    </ContentMenu>
  );
}

function ContentMenu({
  label,
  style,
  actions,
  blockTitle,
  reportKind,
  targetId,
  authorMembershipId,
  authorName,
  disabled,
  deleteTitle = "Delete",
  onEdit,
  onRemove,
  onReported,
  onBlocked,
  children,
}: Readonly<{
  label: string;
  style: StyleProp<ViewStyle>;
  actions: readonly OverflowAction[];
  blockTitle: string;
  reportKind: "moment" | "note";
  targetId: string;
  authorMembershipId: string;
  authorName: string;
  disabled?: boolean;
  deleteTitle?: string;
  onEdit: () => void;
  onRemove: () => void;
  onReported: () => void;
  onBlocked: () => void;
  children: ReactNode;
}>) {
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const items: MenuItem[] = [];
  if (actions.includes("edit")) items.push({ id: "edit", title: "Edit", onPress: onEdit });
  if (actions.includes("delete")) {
    items.push({ id: "delete", title: deleteTitle, destructive: true, onPress: onRemove });
  }
  if (actions.includes("report")) {
    items.push({ id: "report", title: "Report", onPress: () => setReportOpen(true) });
  }
  if (actions.includes("block")) {
    items.push({ id: "block", title: blockTitle, destructive: true, onPress: () => setBlockOpen(true) });
  }

  return (
    <>
      <OverflowTrigger label={label} items={items} style={style} disabled={disabled}>
        {children}
      </OverflowTrigger>
      {reportOpen ? (
        <ReportSheet
          visible
          targetKind={reportKind}
          targetId={targetId}
          onClose={() => setReportOpen(false)}
          onReported={onReported}
        />
      ) : null}
      {blockOpen ? (
        <BlockSheet
          visible
          name={authorName}
          membershipId={authorMembershipId}
          onClose={() => setBlockOpen(false)}
          onBlocked={onBlocked}
        />
      ) : null}
    </>
  );
}

function OverflowTrigger({
  label,
  items,
  style,
  disabled,
  children,
}: Readonly<{
  label: string;
  items: readonly MenuItem[];
  style: StyleProp<ViewStyle>;
  disabled?: boolean;
  children: ReactNode;
}>) {
  if (Platform.OS === "ios") {
    return (
      <IosMenuTrigger style={style} label={label} items={items}>
        {children}
      </IosMenuTrigger>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() =>
        Alert.alert(label, undefined, [
          ...items.map((item) => ({
            text: item.title,
            style: item.destructive ? ("destructive" as const) : ("default" as const),
            onPress: item.onPress,
          })),
          { text: "Cancel", style: "cancel" as const },
        ])
      }
      style={style}
    >
      {children}
    </Pressable>
  );
}

function MoreGlyph({ color }: Readonly<{ color: string }>) {
  return (
    <View style={styles.glyph}>
      <MoreDots color={color} />
    </View>
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
