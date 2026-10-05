/**
 * Overflow actions for a post or comment. Edit and delete stay limited to
 * content the viewer can change. Report is available on every saved post and
 * comment. Block is only other people's content, and only once we know their
 * membership id.
 */
export type OverflowAction = "edit" | "delete" | "report" | "block";

export function blockActionTitle(name: string) {
  const trimmed = name.trim();
  return `Block ${trimmed || "this person"}`;
}

export function momentOverflowActions(
  input: Readonly<{
    kind: string;
    canChange: boolean;
    pending?: boolean;
    authorMembershipId?: string;
    viewerMembershipIds?: readonly string[];
  }>,
): readonly OverflowAction[] {
  if (input.pending) return [];
  const actions: OverflowAction[] = [];
  if (input.canChange) {
    if (input.kind !== "insight") actions.push("edit");
    actions.push("delete");
  }
  actions.push("report");
  if (canBlock(input)) actions.push("block");
  return actions;
}

export function commentOverflowActions(
  input: Readonly<{
    canChange: boolean;
    authorMembershipId?: string;
    viewerMembershipIds?: readonly string[];
  }>,
): readonly OverflowAction[] {
  const actions: OverflowAction[] = [];
  if (input.canChange) actions.push("edit", "delete");
  actions.push("report");
  if (canBlock(input)) actions.push("block");
  return actions;
}

function canBlock(
  input: Readonly<{
    canChange: boolean;
    authorMembershipId?: string;
    viewerMembershipIds?: readonly string[];
  }>,
) {
  const author = input.authorMembershipId ?? "";
  if (!author) return false;
  const viewers = input.viewerMembershipIds ?? [];
  return !viewers.includes(author);
}
