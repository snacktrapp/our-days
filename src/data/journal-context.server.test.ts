// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: vi.fn(),
}));

import {
  buildActivityNotifications,
  buildJournalPersonSurface,
  buildTaggablePeopleByCircle,
  plainToday,
} from "./journal-context.server";

describe("circle calendar date", () => {
  it("uses the circle timezone when one instant spans two local dates", () => {
    const instant = new Date("2026-08-30T07:30:00.000Z");
    expect(plainToday("America/Los_Angeles", instant)).toBe("2026-08-30");
    expect(plainToday("Pacific/Kiritimati", instant)).toBe("2026-08-30");

    const boundary = new Date("2026-08-30T06:30:00.000Z");
    expect(plainToday("America/Los_Angeles", boundary)).toBe("2026-08-29");
    expect(plainToday("Pacific/Kiritimati", boundary)).toBe("2026-08-30");
  });
});

describe("family activity notifications", () => {
  it("keeps only activity on the current member's entries and orders it newest first", () => {
    const notifications = buildActivityNotifications(
      [
        {
          id: "note-one",
          moment_id: "owned",
          author_membership_id: "molly",
          created_at: "2026-09-01T18:00:00.000Z",
        },
        {
          id: "note-other",
          moment_id: "not-owned",
          author_membership_id: "molly",
          created_at: "2026-09-02T18:00:00.000Z",
        },
      ],
      [
        {
          id: "reaction-one",
          moment_id: "owned",
          author_membership_id: "molly",
          reaction_type: "held-close",
          created_at: "2026-09-02T18:00:00.000Z",
        },
      ],
      new Set(["owned"]),
      new Map([["molly", "Molly"]]),
    );

    expect(notifications).toEqual([
      expect.objectContaining({
        id: "reaction:reaction-one:held-close",
        actorName: "Molly",
        message: "loved your entry.",
      }),
      expect.objectContaining({
        id: "note:note-one",
        message: "commented on your entry.",
      }),
    ]);
  });

  it("links family posts to the circle where they are visible", () => {
    const notifications = buildActivityNotifications(
      [],
      [],
      new Set(),
      new Map([["calvin", "Calvin"]]),
      [
        {
          id: "italy-video",
          author_membership_id: "calvin",
          moment_kind: "video",
          created_at: "2026-09-11T18:00:00.000Z",
          audience: "family",
          circle_id: "home-gparents",
        },
      ],
      "brian",
    );

    expect(notifications).toEqual([
      expect.objectContaining({
        id: "moment:italy-video",
        actorName: "Calvin",
        message: "posted a video.",
        href: "/family?circle=home-gparents#moment-italy-video",
      }),
    ]);
  });

  it("notifies other members when someone posts a moment, but not the author", () => {
    const notifications = buildActivityNotifications(
      [],
      [],
      new Set(["brian-photo"]),
      new Map([
        ["tars", "TARS"],
        ["brian", "Brian"],
      ]),
      [
        {
          id: "tars-note",
          author_membership_id: "tars",
          moment_kind: "thought",
          created_at: "2026-09-03T18:00:00.000Z",
        },
        {
          id: "brian-own",
          author_membership_id: "brian",
          moment_kind: "photo",
          created_at: "2026-09-03T19:00:00.000Z",
        },
        {
          id: "tars-insight",
          author_membership_id: "tars",
          moment_kind: "insight",
          created_at: "2026-09-03T20:00:00.000Z",
        },
        {
          id: "tars-just-me",
          author_membership_id: "tars",
          moment_kind: "thought",
          created_at: "2026-09-03T21:00:00.000Z",
          audience: "just_me",
        },
      ],
      "brian",
    );

    expect(notifications).toEqual([
      expect.objectContaining({
        id: "moment:tars-note",
        actorName: "TARS",
        message: "posted a note.",
        href: "/family#moment-tars-note",
      }),
    ]);
  });
});

describe("journal person surface", () => {
  const people = [
    {
      id: "brian",
      name: "Brian",
      initial: "B",
      accent: "teal" as const,
      contextLabel: "You",
      profileKind: "account",
      role: "organizer",
    },
    {
      id: "molly",
      name: "Molly",
      initial: "M",
      accent: "clay" as const,
      contextLabel: "Organizer",
      profileKind: "account",
      role: "organizer",
    },
    {
      id: "tars",
      name: "TARS",
      initial: "T",
      accent: "slate" as const,
      contextLabel: "Operations",
      profileKind: "account",
      role: "organizer",
      directoryKind: "operations",
    },
    {
      id: "avery",
      name: "Avery",
      initial: "A",
      accent: "ochre" as const,
      contextLabel: "Managed journal",
      profileKind: "managed",
      role: undefined,
    },
  ];

  it("omits Operations from Family, People, marks, and composer targets", () => {
    const surface = buildJournalPersonSurface(
      people,
      { personId: "brian", role: "organizer" },
      new Set(),
    );

    expect(surface.people.map((person) => person.name)).toEqual([
      "Brian",
      "Molly",
      "Avery",
    ]);
    expect(surface.familyMark.map((person) => person.id)).toEqual([
      "brian",
      "molly",
      "avery",
    ]);
    expect(surface.taggablePeople.map((person) => person.id)).toEqual([
      "brian",
      "molly",
      "avery",
    ]);
    expect(surface.journalPeople.map((person) => person.id)).toEqual([
      "brian",
      "avery",
    ]);
    expect(
      surface.people.find((person) => person.name === "TARS"),
    ).toBeUndefined();
  });

  it("lets an Operations viewer compose for family journals they administer", () => {
    const surface = buildJournalPersonSurface(
      people,
      { personId: "tars", role: "organizer" },
      new Set(),
    );

    expect(surface.journalPeople.map((person) => person.id)).toEqual(["avery"]);
    expect(surface.people.map((person) => person.id)).toEqual([
      "brian",
      "molly",
      "avery",
    ]);
  });
});

describe("taggable people by postable circle", () => {
  it("keeps a per-circle roster so a thin Home circle does not hide family tags", () => {
    const byCircle = buildTaggablePeopleByCircle(
      ["grandparents", "family"],
      [
        {
          id: "brian-gp",
          display_name: "Brian",
          profile_kind: "account",
          accent_token: "sky",
          circle_id: "grandparents",
        },
        {
          id: "brian",
          display_name: "Brian",
          profile_kind: "account",
          accent_token: "sky",
          circle_id: "family",
        },
        {
          id: "molly",
          display_name: "Molly",
          profile_kind: "account",
          accent_token: "clay",
          circle_id: "family",
        },
        {
          id: "tars",
          display_name: "TARS",
          profile_kind: "account",
          accent_token: "sage",
          circle_id: "family",
        },
      ],
      [
        {
          id: "m-gp",
          person_id: "brian-gp",
          role: "organizer",
          directory_kind: "journal",
          circle_id: "grandparents",
        },
        {
          id: "m-brian",
          person_id: "brian",
          role: "organizer",
          directory_kind: "journal",
          circle_id: "family",
        },
        {
          id: "m-molly",
          person_id: "molly",
          role: "organizer",
          directory_kind: "journal",
          circle_id: "family",
        },
        {
          id: "m-tars",
          person_id: "tars",
          role: "organizer",
          directory_kind: "operations",
          circle_id: "family",
        },
      ],
      new Map([
        ["grandparents", { personId: "brian-gp", role: "organizer" }],
        ["family", { personId: "brian", role: "organizer" }],
      ]),
      "grandparents",
      { personId: "brian-gp", role: "organizer" },
    );

    expect(byCircle.grandparents.map((person) => person.id)).toEqual([
      "brian-gp",
    ]);
    expect(byCircle.family.map((person) => person.id)).toEqual([
      "brian",
      "molly",
    ]);
  });
});
