export type JournalSwitcherKind = "you" | "group" | "person";

export type FamilyTimelineSwitcherItem = Readonly<{
  kind: JournalSwitcherKind;
  label: string;
  href: string;
  current: boolean;
}>;

export function journalSwitcherTypeLabel(kind: JournalSwitcherKind) {
  if (kind === "you") return "You";
  if (kind === "group") return "Group";
  return "Person";
}

export function journalSwitcherEyebrow(
  items: readonly FamilyTimelineSwitcherItem[],
) {
  const current = items.find((item) => item.current);
  return journalSwitcherTypeLabel(current?.kind ?? "group");
}

export function buildJournalSwitcher(input: {
  groupLabel: string;
  people: readonly Readonly<{ id: string; name: string }>[];
  viewerPersonId?: string | null;
  currentHref: string;
}): FamilyTimelineSwitcherItem[] {
  const currentHref = input.currentHref;
  const viewer = input.viewerPersonId
    ? input.people.find((person) => person.id === input.viewerPersonId)
    : undefined;
  const others = input.people.filter((person) => person.id !== viewer?.id);

  return [
    ...(viewer
      ? [
          {
            kind: "you" as const,
            label: viewer.name,
            href: `/people/${viewer.id}`,
            current: currentHref === `/people/${viewer.id}`,
          },
        ]
      : []),
    {
      kind: "group" as const,
      label: input.groupLabel,
      href: "/family",
      current: currentHref === "/family",
    },
    ...others.map((person) => ({
      kind: "person" as const,
      label: person.name,
      href: `/people/${person.id}`,
      current: currentHref === `/people/${person.id}`,
    })),
  ];
}
