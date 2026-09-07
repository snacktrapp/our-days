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
        href: "/family",
        current: true,
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
        href: "/family",
        current: false,
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
