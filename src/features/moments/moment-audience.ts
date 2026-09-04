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
    Boolean(input.viewerPersonId) &&
    input.viewingJournalPersonId === input.viewerPersonId &&
    input.momentJournalPersonId === input.viewerPersonId
  );
}
