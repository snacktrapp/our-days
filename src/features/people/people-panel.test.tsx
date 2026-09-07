import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PeoplePanel } from "./people-panel";
import { buildPeopleViewModel } from "./people-view-model";

const model = buildPeopleViewModel({
  chrome: {
    accent: "teal",
    title: "Our people",
    eyebrow: "Group",
    familyMark: [],
    settingsHref: "/settings/family",
    memoriesHref: "/memories",
    composer: {
      experience: "connected-family",
      previewToday: "2026-08-28",
      defaultJournalPersonId: "brian",
      recorderPersonId: "brian",
      recordedByName: "Brian",
      journalPeople: [],
      taggablePeople: [],
    },
  },
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
          roleLabel: "Co-organizer",
          journalHref: "/people/brian",
        },
        {
          id: "molly",
          name: "Molly",
          initial: "M",
          accent: "clay",
          roleLabel: "Co-organizer",
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

describe("PeoplePanel", () => {
  it("lists each circle with its members and the Account invite path", () => {
    render(<PeoplePanel model={model} />);

    expect(screen.getByRole("heading", { name: "All our days" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Cousins" })).toBeVisible();
    expect(screen.getByText("2 people")).toBeVisible();
    expect(screen.getByText("1 person")).toBeVisible();
    expect(screen.getByRole("link", { name: /Molly/u })).toHaveAttribute(
      "href",
      "/people/molly",
    );
    expect(screen.queryByText("TARS")).toBeNull();
    const invites = screen.getAllByRole("link", {
      name: "Invite into this circle",
    });
    expect(invites).toHaveLength(2);
    expect(invites[0]).toHaveAttribute(
      "href",
      "/settings/family?inviteCircle=family#invite",
    );
    expect(invites[1]).toHaveAttribute(
      "href",
      "/settings/family?inviteCircle=cousins#invite",
    );
  });
});
