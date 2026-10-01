/**
 * Edit uses `update_written_moment`, which only fits a written entry.
 * Delete uses `set_written_moment_trashed`, which removes any post the
 * viewer can change. A post with neither action does not show a menu.
 */
export function momentOverflowActions(kind: string): readonly ("edit" | "delete")[] {
  if (kind === "thought") return ["edit", "delete"];
  return ["delete"];
}
