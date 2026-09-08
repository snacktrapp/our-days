import type { AccentToken } from "@/features/accent-token";
import type { PostableCircle } from "./post-to";

export type ComposerPersonOption = Readonly<{
  id: string;
  name: string;
  initial: string;
  accent: AccentToken;
  contextLabel: string;
}>;

export type MomentComposerViewModel = Readonly<{
  experience?: "preview" | "connected-written" | "connected-family";
  circleId?: string;
  photoPostingEnabled?: boolean;
  previewToday: string;
  defaultJournalPersonId: string;
  recorderPersonId: string;
  recordedByName: string;
  journalPeople: readonly ComposerPersonOption[];
  taggablePeople: readonly ComposerPersonOption[];
  taggablePeopleByCircle?: Readonly<
    Record<string, readonly ComposerPersonOption[]>
  >;
  postableCircles?: readonly PostableCircle[];
}>;

export function taggablePeopleForSelectedCircles(
  homeTaggablePeople: readonly ComposerPersonOption[],
  taggablePeopleByCircle:
    Readonly<Record<string, readonly ComposerPersonOption[]>> | undefined,
  selectedCircleIds: readonly string[],
  justMe: boolean,
): readonly ComposerPersonOption[] {
  if (justMe || selectedCircleIds.length === 0 || !taggablePeopleByCircle) {
    return homeTaggablePeople;
  }
  const seen = new Set<string>();
  const union: ComposerPersonOption[] = [];
  let knownCircle = false;
  for (const circleId of selectedCircleIds) {
    const people = taggablePeopleByCircle[circleId];
    if (people === undefined) continue;
    knownCircle = true;
    for (const person of people) {
      if (seen.has(person.id)) continue;
      seen.add(person.id);
      union.push(person);
    }
  }
  return knownCircle ? union : homeTaggablePeople;
}
