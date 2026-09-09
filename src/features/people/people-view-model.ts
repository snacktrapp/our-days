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

export const peopleIntro =
  "Everyone in your circles, organized by circle — not by the Home switcher.";

export function peopleInviteHref(circleId: string) {
  const params = new URLSearchParams({ inviteCircle: circleId });
  return `/settings/family?${params.toString()}#invite`;
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
    chrome: { ...input.chrome, title: "Our people" },
    intro: input.intro ?? peopleIntro,
    groups: input.groups.map((group) => ({
      id: group.id,
      name: group.name,
      members: group.members,
      inviteHref: group.canInvite ? peopleInviteHref(group.id) : null,
    })),
  };
}
