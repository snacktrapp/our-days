import { describe, expect, it } from "vitest";
import {
  buildJournalSwitcher,
  currentHomeContext,
  journalSwitcherEyebrow,
  journalSwitcherSections,
  journalSwitcherTypeLabel,
  journalTimelineHref,
} from "./journal-switcher";

const people = [
  { id: "brian", name: "Brian" },
  { id: "molly", name: "Molly" },
  { id: "calvin", name: "Calvin" },
] as const;

describe("journal switcher grammar", () => {
  it("puts Just me first, then All and circles, then other people", () => {
    expect(
      buildJournalSwitcher({
        groupLabel: "Trapp Family",
        people,
        viewerPersonId: "brian",
        currentHref: "/family",
      }),
    ).toEqual([
      {
        kind: "you",
        label: "Brian",
        href: "/people/brian",
        current: false,
      },
      {
        kind: "all",
        label: "All circles",
        href: "/family",
        current: true,
      },
      {
        kind: "group",
        label: "Trapp Family",
        href: "/family?circle=family",
        current: false,
        circleId: "family",
      },
      {
        kind: "person",
        label: "Molly",
        href: "/people/molly",
        current: false,
      },
      {
        kind: "person",
        label: "Calvin",
        href: "/people/calvin",
        current: false,
      },
    ]);
  });

  it("lists every group after All and keeps ?circle= as a single-circle feed", () => {
    expect(
      buildJournalSwitcher({
        groups: [
          { id: "family", name: "Trapp Family" },
          { id: "cousins", name: "Cousins" },
        ],
        people: [{ id: "brian", name: "Brian" }],
        viewerPersonId: "brian",
        currentHref: "/family?circle=cousins",
        activeGroupId: "cousins",
      }),
    ).toEqual([
      {
        kind: "you",
        label: "Brian",
        href: "/people/brian",
        current: false,
      },
      {
        kind: "all",
        label: "All circles",
        href: "/family",
        current: false,
      },
      {
        kind: "group",
        label: "Trapp Family",
        href: "/family?circle=family",
        current: false,
        circleId: "family",
      },
      {
        kind: "group",
        label: "Cousins",
        href: "/family?circle=cousins",
        current: true,
        circleId: "cousins",
      },
    ]);
  });

  it("does not invent a Just me row when the viewer is not in the list", () => {
    expect(
      buildJournalSwitcher({
        groupLabel: "Our family",
        people: [{ id: "child", name: "Child" }],
        viewerPersonId: "parent",
        currentHref: "/people/child",
      }),
    ).toEqual([
      {
        kind: "all",
        label: "All circles",
        href: "/family",
        current: false,
      },
      {
        kind: "group",
        label: "Our family",
        href: "/family?circle=family",
        current: false,
        circleId: "family",
      },
      {
        kind: "person",
        label: "Child",
        href: "/people/child",
        current: true,
      },
    ]);
  });

  it("reads the active Home switcher row as composer context", () => {
    const items = buildJournalSwitcher({
      groups: [
        { id: "family", name: "Trapp Family" },
        { id: "cousins", name: "Cousins" },
      ],
      people,
      viewerPersonId: "brian",
      currentHref: "/people/brian",
    });
    expect(currentHomeContext(items)).toEqual({ kind: "you" });
    expect(
      currentHomeContext(
        buildJournalSwitcher({
          groups: [
            { id: "family", name: "Trapp Family" },
            { id: "cousins", name: "Cousins" },
          ],
          people,
          viewerPersonId: "brian",
          currentHref: "/family",
        }),
      ),
    ).toEqual({ kind: "all" });
    expect(
      currentHomeContext(
        buildJournalSwitcher({
          groups: [
            { id: "family", name: "Trapp Family" },
            { id: "cousins", name: "Cousins" },
          ],
          people,
          viewerPersonId: "brian",
          currentHref: "/family?circle=cousins",
          activeGroupId: "cousins",
        }),
      ),
    ).toEqual({ kind: "group", circleId: "cousins" });
    expect(
      currentHomeContext(
        buildJournalSwitcher({
          groupLabel: "Trapp Family",
          people,
          viewerPersonId: "brian",
          currentHref: "/people/molly",
        }),
      ),
    ).toEqual({ kind: "person" });
    expect(currentHomeContext(undefined)).toBeUndefined();
  });

  it("labels the selected type for the header eyebrow", () => {
    expect(journalSwitcherTypeLabel("all")).toBe("Circles");
    expect(journalSwitcherTypeLabel("you")).toBe("Just me");
    expect(journalSwitcherTypeLabel("group")).toBe("Circles");
    expect(journalSwitcherTypeLabel("person")).toBe("Person");
    expect(
      journalSwitcherEyebrow([
        {
          kind: "you",
          label: "Brian",
          href: "/people/brian",
          current: true,
        },
      ]),
    ).toBe("Just me");
  });

  it("groups rows into Just me, Circles, and Person sections", () => {
    const sections = journalSwitcherSections(
      buildJournalSwitcher({
        groups: [
          { id: "family", name: "Trapp Family" },
          { id: "cousins", name: "Cousins" },
        ],
        people,
        viewerPersonId: "brian",
        currentHref: "/family",
      }),
    );
    expect(sections.justMe.map((item) => item.label)).toEqual(["Brian"]);
    expect(sections.circles.map((item) => item.label)).toEqual([
      "All circles",
      "Trapp Family",
      "Cousins",
    ]);
    expect(sections.people.map((item) => item.label)).toEqual([
      "Molly",
      "Calvin",
    ]);
  });

  it("keeps member counts on circle rows and omits them on All", () => {
    const items = buildJournalSwitcher({
      groups: [
        { id: "family", name: "Trapp Family", memberCount: 3 },
        { id: "cousins", name: "Cousins", memberCount: 2 },
      ],
      people,
      viewerPersonId: "brian",
      currentHref: "/family",
    });
    expect(
      items.find((item) => item.kind === "all")?.memberCount,
    ).toBeUndefined();
    expect(
      items
        .filter((item) => item.kind === "group")
        .map((item) => [item.label, item.memberCount]),
    ).toEqual([
      ["Trapp Family", 3],
      ["Cousins", 2],
    ]);
  });

  it("keeps All pagination on the bare family path", () => {
    expect(journalTimelineHref("/family", 2, "2026-08-30T10:00:01Z")).toBe(
      "/family?pages=2&snapshot=2026-08-30T10%3A00%3A01Z",
    );
    expect(
      journalTimelineHref("/family?circle=cousins", 2, "2026-08-30T10:00:01Z"),
    ).toBe("/family?circle=cousins&pages=2&snapshot=2026-08-30T10%3A00%3A01Z");
  });
});
