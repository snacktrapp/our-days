export type JournalSwitcherKind = "all" | "you" | "group" | "person";

export type FamilyTimelineSwitcherItem = Readonly<{
  kind: JournalSwitcherKind;
  label: string;
  href: string;
  current: boolean;
  circleId?: string;
  memberCount?: number;
}>;

export type JournalSwitcherGroup = Readonly<{
  id: string;
  name: string;
  memberCount?: number;
}>;

export const allHomeHref = "/family";

export function journalSwitcherTypeLabel(kind: JournalSwitcherKind) {
  if (kind === "you") return "Just me";
  if (kind === "person") return "Person";
  return "Circles";
}

export function currentHomeContext(
  items: readonly FamilyTimelineSwitcherItem[] | undefined,
):
  | Readonly<{
      kind: JournalSwitcherKind;
      circleId?: string;
    }>
  | undefined {
  const current = items?.find((item) => item.current);
  if (!current) return undefined;
  return {
    kind: current.kind,
    ...(current.circleId ? { circleId: current.circleId } : {}),
  };
}

export function journalSwitcherEyebrow(
  items: readonly FamilyTimelineSwitcherItem[],
) {
  const current = items.find((item) => item.current);
  return journalSwitcherTypeLabel(current?.kind ?? "all");
}

export function isFamilyHomePath(href: string) {
  const path = href.split("?")[0] ?? href;
  return path === "/family";
}

export function isGroupHomeHref(href: string) {
  return isFamilyHomePath(href);
}

export function familyCircleIdFromHref(href: string) {
  if (!isFamilyHomePath(href)) return null;
  const query = href.split("?")[1] ?? "";
  return new URLSearchParams(query).get("circle");
}

export function isAllHomeHref(href: string) {
  return isFamilyHomePath(href) && !familyCircleIdFromHref(href);
}

export function groupHomeHref(circleId: string) {
  return `/family?circle=${encodeURIComponent(circleId)}`;
}

export function journalTimelineHref(
  baseHref: string,
  pages: number,
  snapshot: string,
) {
  const url = new URL(baseHref, "https://our-days.local");
  url.searchParams.set("pages", String(pages));
  url.searchParams.set("snapshot", snapshot);
  return `${url.pathname}${url.search}`;
}

export function journalSwitcherSections(
  items: readonly FamilyTimelineSwitcherItem[],
) {
  return {
    justMe: items.filter((item) => item.kind === "you"),
    circles: items.filter(
      (item) => item.kind === "all" || item.kind === "group",
    ),
    people: items.filter((item) => item.kind === "person"),
  };
}

export function buildJournalSwitcher(input: {
  groups?: readonly JournalSwitcherGroup[];
  groupLabel?: string;
  people: readonly Readonly<{ id: string; name: string }>[];
  viewerPersonId?: string | null;
  viewerPersonIds?: readonly string[];
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
  const currentHref = input.currentHref;
  const viewerIds = new Set(
    [
      ...(input.viewerPersonIds ?? []),
      ...(input.viewerPersonId ? [input.viewerPersonId] : []),
    ].filter(Boolean),
  );
  const viewer = input.people.find((person) => viewerIds.has(person.id));
  const others = input.people.filter((person) => !viewerIds.has(person.id));
  const selectedCircleId = familyCircleIdFromHref(currentHref);
  const onFamilyPath = isFamilyHomePath(currentHref);

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
      kind: "all" as const,
      label: "All",
      href: allHomeHref,
      current: onFamilyPath && !selectedCircleId,
    },
    ...groups.map((group) => ({
      kind: "group" as const,
      label: group.name,
      href: groupHomeHref(group.id),
      current: onFamilyPath && selectedCircleId === group.id,
      circleId: group.id,
      ...(group.memberCount != null ? { memberCount: group.memberCount } : {}),
    })),
    ...others.map((person) => ({
      kind: "person" as const,
      label: person.name,
      href: `/people/${person.id}`,
      current: currentHref === `/people/${person.id}`,
    })),
  ];
}
