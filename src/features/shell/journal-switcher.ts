export type JournalSwitcherKind = "you" | "group" | "person";

export type FamilyTimelineSwitcherItem = Readonly<{
  kind: JournalSwitcherKind;
  label: string;
  href: string;
  current: boolean;
  circleId?: string;
}>;

export type JournalSwitcherGroup = Readonly<{
  id: string;
  name: string;
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

export function isGroupHomeHref(href: string) {
  const path = href.split("?")[0] ?? href;
  return path === "/family";
}

export function groupHomeHref(circleId: string) {
  return `/family?circle=${encodeURIComponent(circleId)}`;
}

export function buildJournalSwitcher(input: {
  groups?: readonly JournalSwitcherGroup[];
  groupLabel?: string;
  people: readonly Readonly<{ id: string; name: string }>[];
  viewerPersonId?: string | null;
  currentHref: string;
  activeGroupId?: string | null;
}): FamilyTimelineSwitcherItem[] {
  const groups =
    input.groups && input.groups.length > 0
      ? input.groups
      : [
          {
            id: input.activeGroupId ?? "family",
            name: input.groupLabel ?? "Our family",
          },
        ];
  const activeGroupId = input.activeGroupId ?? groups[0]?.id;
  const currentHref = input.currentHref;
  const viewer = input.viewerPersonId
    ? input.people.find((person) => person.id === input.viewerPersonId)
    : undefined;
  const others = input.people.filter((person) => person.id !== viewer?.id);
  const onGroupHome = isGroupHomeHref(currentHref);

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
    ...groups.map((group) => ({
      kind: "group" as const,
      label: group.name,
      href: groupHomeHref(group.id),
      current: onGroupHome && group.id === activeGroupId,
      circleId: group.id,
    })),
    ...others.map((person) => ({
      kind: "person" as const,
      label: person.name,
      href: `/people/${person.id}`,
      current: currentHref === `/people/${person.id}`,
    })),
  ];
}
