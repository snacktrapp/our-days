/**
 * Pure state steps for the native conversation (comments and hearts), so the
 * optimistic heart writes and their rollbacks match the web
 * `moment-conversation-control.tsx` and can be tested under plain Node.
 */
import type { FeedNote, FeedReaction } from "./journal";

export type Mention = Readonly<{ userId: string; name: string; start: number; end: number }>;

/** Web `withCurrentMemberReaction` for the heart: drop the viewer's heart, add it back when loved. */
export function withViewerLove(
  reactions: readonly FeedReaction[],
  viewerName: string,
  momentId: string,
  loved: boolean,
): readonly FeedReaction[] {
  const kept = reactions.filter(
    (reaction) => !(reaction.isCurrentMember && reaction.reactionId === "held-close"),
  );
  if (!loved) return kept;
  return [
    ...kept,
    {
      id: `local-heart-${momentId}`,
      personName: viewerName,
      reactionId: "held-close",
      isCurrentMember: true,
    },
  ];
}

/** Web `chooseNoteHeart` local step: names, count, and the viewer's heart move together. */
export function withNoteHeart(
  notes: readonly FeedNote[],
  noteId: string,
  viewerName: string,
  hearted: boolean,
): readonly FeedNote[] {
  return notes.map((note) => {
    if (note.id !== noteId) return note;
    const others = note.heartNames.filter((name) => name !== viewerName);
    const names = hearted ? [...others, viewerName] : others;
    return { ...note, heartedByViewer: hearted, heartNames: names, heartCount: names.length };
  });
}

/** Undo one optimistic note heart without disturbing anything else that changed since. */
export function revertNoteHeart(
  notes: readonly FeedNote[],
  prior: FeedNote,
): readonly FeedNote[] {
  return notes.map((note) =>
    note.id === prior.id
      ? {
          ...note,
          heartedByViewer: prior.heartedByViewer,
          heartNames: prior.heartNames,
          heartCount: prior.heartCount,
        }
      : note,
  );
}

/** The comment just saved, shown before the next feed load brings it back. */
export function newNote(
  input: Readonly<{
    id: string;
    authorName: string;
    authorAccent: string;
    body: string;
    mentions: readonly Mention[];
    now?: Date;
  }>,
): FeedNote {
  return {
    id: input.id,
    authorName: input.authorName,
    authorAccent: input.authorAccent,
    body: input.body,
    createdAt: (input.now ?? new Date()).toISOString(),
    heartCount: 0,
    heartedByViewer: false,
    heartNames: [],
    canChange: true,
    revision: 1,
    mentions: input.mentions.map((mention) => ({
      userId: mention.userId,
      start: mention.start,
      end: mention.end,
      name: mention.name,
      active: true,
    })),
  };
}

/** Web double-tap rule: two taps within 300 ms and 32 pt; finger moved < 10 pt. */
export const noteDoubleTapMs = 300;
export const noteDoubleTapPx = 32;

export function isNoteDoubleTap(
  previous: Readonly<{ noteId: string; t: number; x: number; y: number }> | null,
  next: Readonly<{ noteId: string; t: number; x: number; y: number }>,
) {
  return (
    previous != null &&
    previous.noteId === next.noteId &&
    next.t - previous.t < noteDoubleTapMs &&
    Math.hypot(previous.x - next.x, previous.y - next.y) < noteDoubleTapPx
  );
}

/** Web DoubleTapPhoto: a finger that moves more than this is a swipe, not a tap. */
export const postTapSlopPx = 10;

export type PostTap = Readonly<{ t: number; x: number; y: number }>;

/** Web DoubleTapPhoto: second tap within 300 ms and 32 pt of the first. */
export function isPostDoubleTap(previous: PostTap | null, next: PostTap) {
  return (
    previous != null &&
    next.t - previous.t < noteDoubleTapMs &&
    Math.hypot(previous.x - next.x, previous.y - next.y) < noteDoubleTapPx
  );
}

/** Web conversation `our-days:heart` listener: accept only a new love, never while saving. */
export function acceptsDoubleTapLove(input: Readonly<{ loved: boolean; pending: boolean }>) {
  return !input.loved && !input.pending;
}
