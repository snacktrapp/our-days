import {
  activityMomentHref,
  activityNotificationTitle,
  commentHeartMessage,
  entryCommentMessage,
  entryReactionMessage,
  familyMomentPostedMessage,
  mentionNotificationMessage,
} from "@/lib/activity-notifications";

export type ExpoDeliveryKind =
  "moment" | "note" | "reaction" | "mention" | "note_reaction";

export type ExpoDeliveryRow = Readonly<{
  token: string;
  actor_name: string | null;
  moment_id: string;
  moment_kind: string | null;
  reaction_type: string | null;
  snippet: string | null;
  note_id: string | null;
}>;

/** Same All-circles destination the web notification tap uses. */
export function expoNotificationHref(
  kind: ExpoDeliveryKind,
  row: Pick<ExpoDeliveryRow, "moment_id" | "note_id">,
) {
  const opensComment =
    kind === "note" ||
    kind === "note_reaction" ||
    (kind === "mention" && Boolean(row.note_id));
  return activityMomentHref(
    row.moment_id,
    opensComment
      ? { noteId: row.note_id, thread: true }
      : kind === "reaction"
        ? { thread: true }
        : undefined,
  );
}

export function expoNotificationTitle(
  kind: ExpoDeliveryKind,
  row: ExpoDeliveryRow,
) {
  const actorName = row.actor_name?.trim() || "Family";
  if (kind === "mention") {
    return activityNotificationTitle(
      actorName,
      mentionNotificationMessage(row.snippet ?? ""),
    );
  }
  if (kind === "note_reaction") {
    return activityNotificationTitle(actorName, commentHeartMessage);
  }
  if (kind === "note") {
    return activityNotificationTitle(actorName, entryCommentMessage);
  }
  if (kind === "reaction" || row.reaction_type) {
    return activityNotificationTitle(
      actorName,
      entryReactionMessage(row.reaction_type ?? ""),
    );
  }
  return activityNotificationTitle(
    actorName,
    familyMomentPostedMessage(row.moment_kind ?? ""),
  );
}
