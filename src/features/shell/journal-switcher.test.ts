import { describe, expect, it } from "vitest";
import {
  buildJournalSwitcher,
  journalSwitcherEyebrow,
  journalSwitcherTypeLabel,
} from "./journal-switcher";

const people = [
  { id: "brian", name: "Brian" },
  { id: "molly", name: "Molly" },
  { id: "calvin", name: "Calvin" },
] as const;

describe("journal switcher grammar", () => {
  it("puts You first, then the group, then other people", () => {
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
        kind: "group",
        label: "Trapp Family",
        href: "/family?circle=family",
        current: true,
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

  it("lists every group the member is in after You and before people", () => {
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

  it("does not invent a You row when the viewer is not in the list", () => {
    expect(
      buildJournalSwitcher({
        groupLabel: "Our family",
        people: [{ id: "child", name: "Child" }],
        viewerPersonId: "parent",
        currentHref: "/people/child",
      }),
    ).toEqual([
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

  it("labels the selected type for the header eyebrow", () => {
    expect(journalSwitcherTypeLabel("you")).toBe("You");
    expect(journalSwitcherTypeLabel("group")).toBe("Group");
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
    ).toBe("You");
  });
});
