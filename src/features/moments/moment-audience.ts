export type MomentAudience = "family" | "just_me";

export function normalizeMomentAudience(value: unknown): MomentAudience {
  return value === "just_me" ? "just_me" : "family";
}

export function showJustMeAudienceBadge(input: {
  audience: unknown;
  viewerPersonId?: string;
  viewingJournalPersonId?: string;
  momentJournalPersonId?: string | null;
}) {
  return (
    normalizeMomentAudience(input.audience) === "just_me" &&
    showAudienceChip(input)
  );
}

export function showAudienceChip(input: {
  viewerPersonId?: string;
  viewingJournalPersonId?: string;
  momentJournalPersonId?: string | null;
}) {
  return (
    Boolean(input.viewerPersonId) &&
    input.viewingJournalPersonId === input.viewerPersonId &&
    input.momentJournalPersonId === input.viewerPersonId
  );
}

export function audienceCircleCount(input: {
  audience: unknown;
  linkedCircleIds?: readonly string[] | null;
}) {
  if (normalizeMomentAudience(input.audience) === "just_me") return 0;
  const count = input.linkedCircleIds?.filter(Boolean).length ?? 0;
  return count > 0 ? count : 1;
}

export function formatAudienceChipLabel(input: {
  audience: unknown;
  linkedCircleIds?: readonly string[] | null;
}) {
  if (normalizeMomentAudience(input.audience) === "just_me") return "Just me";
  const count = audienceCircleCount(input);
  return count === 1 ? "1 group" : `${count} groups`;
}
