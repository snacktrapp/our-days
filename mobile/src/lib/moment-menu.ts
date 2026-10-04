/**
 * Web `ConnectedMomentControl`: Edit opens the composer for every changeable
 * post except an Insight; Move to trash (`set_written_moment_trashed`) works
 * for any post the viewer can change. A post with neither shows no menu.
 */
export function momentOverflowActions(kind: string): readonly ("edit" | "delete")[] {
  if (kind === "insight") return ["delete"];
  return ["edit", "delete"];
}
