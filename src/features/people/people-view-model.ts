import type { AccentToken } from "@/features/accent-token";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";

export type PersonSummaryViewModel = Readonly<{
  id: string;
  name: string;
  initial: string;
  accent: AccentToken;
  roleLabel: string;
  journalHref?: string;
}>;

export type PeopleGroupViewModel = Readonly<{
  id: string;
  name: string;
  members: readonly PersonSummaryViewModel[];
  inviteHref: string | null;
}>;

export type PeopleViewModel = Readonly<{
  chrome: JournalChromeViewModel;
  intro: string;
  groups: readonly PeopleGroupViewModel[];
}>;

export const peopleIntro = "Choose a circle or a person’s journal.";

export function peopleInviteHref(circleId: string) {
  const params = new URLSearchParams({ inviteCircle: circleId });
  return `/circles/manage?${params.toString()}#invite`;
}

export function peopleCountLabel(count: number) {
  return count === 1 ? "1 person" : `${count} people`;
}

export function buildPeopleViewModel(input: {
  chrome: JournalChromeViewModel;
  intro?: string;
  groups: readonly Readonly<{
    id: string;
    name: string;
    members: readonly PersonSummaryViewModel[];
    canInvite: boolean;
  }>[];
}): PeopleViewModel {
  return {
    chrome: { ...input.chrome, title: "Circles", eyebrow: "Journals" },
    intro: input.intro ?? peopleIntro,
    groups: input.groups.map((group) => ({
      id: group.id,
      name: group.name,
      members: group.members,
      inviteHref: group.canInvite ? peopleInviteHref(group.id) : null,
    })),
  };
}
