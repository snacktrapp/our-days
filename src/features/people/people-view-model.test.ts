import { describe, expect, it } from "vitest";
import {
  buildPeopleViewModel,
  peopleCountLabel,
  peopleInviteHref,
} from "./people-view-model";

const chrome = {
  accent: "teal" as const,
  title: "All our days",
  eyebrow: "Circle",
  familyMark: [],
  settingsHref: "/settings/family",
  memoriesHref: "/memories",
  composer: {
    experience: "connected-family" as const,
    previewToday: "2026-08-28",
    defaultJournalPersonId: "brian",
    recorderPersonId: "brian",
    recordedByName: "Brian",
    journalPeople: [],
    taggablePeople: [],
  },
};

describe("people view model", () => {
  it("groups people independently of Home and invites into that circle", () => {
    const model = buildPeopleViewModel({
      chrome,
      groups: [
        {
          id: "family",
          name: "All our days",
          canInvite: true,
          members: [
            {
              id: "brian",
              name: "Brian",
              initial: "B",
              accent: "teal",
              roleLabel: "Organizer",
              journalHref: "/people/brian",
            },
            {
              id: "molly",
              name: "Molly",
              initial: "M",
              accent: "clay",
              roleLabel: "Organizer",
              journalHref: "/people/molly",
            },
          ],
        },
        {
          id: "cousins",
          name: "Cousins",
          canInvite: true,
          members: [
            {
              id: "brian-cousins",
              name: "Brian",
              initial: "B",
              accent: "teal",
              roleLabel: "Organizer",
              journalHref: "/people/brian-cousins",
            },
          ],
        },
      ],
    });

    expect(model.chrome.title).toBe("Our people");
    expect(model.groups.map((group) => group.name)).toEqual([
      "All our days",
      "Cousins",
    ]);
    expect(model.groups[0]?.members.map((person) => person.name)).toEqual([
      "Brian",
      "Molly",
    ]);
    expect(model.groups[1]?.inviteHref).toBe(peopleInviteHref("cousins"));
    expect(peopleInviteHref("cousins")).toContain("inviteCircle=cousins");
    expect(peopleInviteHref("cousins")).toContain("#invite");
    expect(peopleCountLabel(1)).toBe("1 person");
    expect(peopleCountLabel(2)).toBe("2 people");
  });

  it("hides invite when the viewer cannot invite into that circle", () => {
    const model = buildPeopleViewModel({
      chrome,
      groups: [
        {
          id: "family",
          name: "All our days",
          canInvite: false,
          members: [],
        },
      ],
    });
    expect(model.groups[0]?.inviteHref).toBeNull();
  });
});
