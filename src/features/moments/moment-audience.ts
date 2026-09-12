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
  return normalizeMomentAudience(input.audience) === "just_me";
}

export function showAudienceChip(_input?: {
  viewerPersonId?: string;
  viewingJournalPersonId?: string;
  momentJournalPersonId?: string | null;
  momentKind?: string | null;
}) {
  return _input?.momentKind !== "insight";
}

export function audienceCircleIds(input: {
  audience: unknown;
  linkedCircleIds?: readonly string[] | null;
  circleId?: string | null;
}) {
  if (normalizeMomentAudience(input.audience) === "just_me") return [];
  const linked = input.linkedCircleIds?.filter(Boolean) ?? [];
  if (linked.length > 0) return [...linked];
  return input.circleId ? [input.circleId] : [];
}

export function audienceCircleCount(input: {
  audience: unknown;
  linkedCircleIds?: readonly string[] | null;
  circleId?: string | null;
}) {
  if (normalizeMomentAudience(input.audience) === "just_me") return 0;
  const count = audienceCircleIds(input).length;
  return count > 0 ? count : 1;
}

export function compactAudienceCircleLabel(
  ids: readonly string[],
  names?: Readonly<Record<string, string>>,
) {
  const known = ids.flatMap((id) => {
    const name = names?.[id]?.trim();
    return name ? [name] : [];
  });
  if (ids.length <= 1) {
    return known[0] ?? "1 circle";
  }
  if (ids.length === 2) {
    return known[0] ? `${known[0]} +1` : "2 circles";
  }
  return `${ids.length} circles`;
}

export function audienceCircleNames(input: {
  audience: unknown;
  linkedCircleIds?: readonly string[] | null;
  circleId?: string | null;
  circleNames?: Readonly<Record<string, string>>;
}) {
  if (normalizeMomentAudience(input.audience) === "just_me") return ["Just me"];
  const ids = audienceCircleIds(input);
  const names = ids.flatMap((id) => {
    const name = input.circleNames?.[id]?.trim();
    return name ? [name] : [];
  });
  return names;
}

export function formatAudienceChipLabel(input: {
  audience: unknown;
  linkedCircleIds?: readonly string[] | null;
  circleId?: string | null;
  circleNames?: Readonly<Record<string, string>>;
  feedCircleId?: string | null;
}) {
  if (normalizeMomentAudience(input.audience) === "just_me") return "Just me";
  const ids = audienceCircleIds(input);
  const labeledIds = ids.length > 0 ? ids : [];
  if (input.feedCircleId) {
    const others = labeledIds.filter((id) => id !== input.feedCircleId);
    if (others.length > 0) {
      return `Also · ${compactAudienceCircleLabel(others, input.circleNames)}`;
    }
  }
  return compactAudienceCircleLabel(
    labeledIds.length > 0 ? labeledIds : ["_"],
    input.circleNames,
  );
}
