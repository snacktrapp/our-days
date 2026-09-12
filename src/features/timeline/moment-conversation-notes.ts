export const VISIBLE_CONVERSATION_NOTE_LIMIT = 2;

/**
 * Feed batch reads and `get_moment_conversation` return notes oldest-first
 * (`created_at` ascending). The visible window is newest-first so a new
 * reply is not buried; older notes stay behind Show more.
 */
export function visibleConversationNotes<T>(
  notes: readonly T[],
  showAll: boolean,
  limit = VISIBLE_CONVERSATION_NOTE_LIMIT,
): T[] {
  const newestFirst = notes.slice().reverse();
  return showAll ? newestFirst : newestFirst.slice(0, limit);
}

export function hiddenConversationNoteCount(
  noteCount: number,
  limit = VISIBLE_CONVERSATION_NOTE_LIMIT,
): number {
  return Math.max(0, noteCount - limit);
}
