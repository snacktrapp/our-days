// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const readMemberships = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: vi.fn(),
}));
vi.mock("@/lib/auth/journal-access", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/auth/journal-access")
  >("@/lib/auth/journal-access");
  return {
    ...actual,
    readJournalCircleMemberships: readMemberships,
  };
});

import { createOurDaysServerClient } from "@/lib/supabase/server";
import {
  buildActivityNotifications,
  buildJournalPersonSurface,
  buildTaggablePeopleByCircle,
  loadConnectedJournalContext,
  plainToday,
} from "./journal-context.server";

const access = {
  mode: "authenticated" as const,
  membershipId: "membership-brian",
  circleId: "family",
  personId: "brian",
  role: "organizer",
};

function thenableQuery(
  result:
    | { data: unknown; error: unknown }
    | (() => { data: unknown; error: unknown }),
) {
  const resolve = () => (typeof result === "function" ? result() : result);
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    neq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    then: (
      onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.neq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.single.mockImplementation(() => Promise.resolve(resolve()));
  return query;
}

function requiredRows() {
  return {
    circle: {
      id: "family",
      name: "Our family",
      time_zone: "America/Los_Angeles",
    },
    people: [
      {
        id: "brian",
        display_name: "Brian",
        profile_kind: "account",
        accent_token: "sky",
        circle_id: "family",
      },
    ],
    memberships: [
      {
        id: "membership-brian",
        person_id: "brian",
        role: "organizer",
        status: "active",
        directory_kind: "journal",
        circle_id: "family",
      },
    ],
    groups: [
      {
        id: "family",
        name: "Our family",
        created_by_membership_id: "membership-brian",
      },
    ],
  };
}

function connectedClient(
  overrides: {
    people?:
      | { data: unknown; error: unknown }
      | (() => { data: unknown; error: unknown });
    notes?: { data: unknown; error: unknown };
    reactions?: { data: unknown; error: unknown };
    momentCircles?: { data: unknown; error: unknown };
    ownedMoments?: { data: unknown; error: unknown };
    linkedMoments?: { data: unknown; error: unknown };
    throwOn?: string;
  } = {},
) {
  const rows = requiredRows();
  let momentsCalls = 0;
  const momentCircles = thenableQuery(
    overrides.momentCircles ?? { data: [], error: null },
  );
  const from = vi.fn((table: string) => {
    if (overrides.throwOn === table) {
      throw { code: "PGRST301", message: "JWT expired" };
    }
    if (table === "circles") {
      const query = thenableQuery({ data: rows.groups, error: null });
      query.single.mockImplementation(() =>
        Promise.resolve({ data: rows.circle, error: null }),
      );
      return query;
    }
    if (table === "people") {
      const peopleResult = overrides.people;
      if (typeof peopleResult === "function") {
        return thenableQuery(peopleResult);
      }
      return thenableQuery(peopleResult ?? { data: rows.people, error: null });
    }
    if (table === "circle_memberships") {
      return thenableQuery({ data: rows.memberships, error: null });
    }
    if (table === "person_guardians") {
      return thenableQuery({ data: [], error: null });
    }
    if (table === "moments") {
      momentsCalls += 1;
      if (momentsCalls === 1) {
        return thenableQuery(
          overrides.ownedMoments ?? { data: [], error: null },
        );
      }
      return thenableQuery(
        overrides.linkedMoments ?? { data: [], error: null },
      );
    }
    if (table === "moment_circles") return momentCircles;
    if (table === "moment_notes") {
      return thenableQuery(overrides.notes ?? { data: [], error: null });
    }
    if (table === "moment_reactions") {
      return thenableQuery(overrides.reactions ?? { data: [], error: null });
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  vi.mocked(createOurDaysServerClient).mockResolvedValue({ from } as never);
  return { from, momentCircles };
}

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

describe("connected journal context load", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function stubMemberships() {
    readMemberships.mockResolvedValue([
      {
        membershipId: access.membershipId,
        circleId: access.circleId,
        personId: access.personId,
        role: access.role,
      },
    ]);
  }

  it("keeps the journal open when optional Activity queries fail", async () => {
    stubMemberships();
    connectedClient({
      notes: { data: null, error: { message: "moment_notes timed out" } },
      reactions: {
        data: null,
        error: { message: "moment_reactions timed out" },
      },
      momentCircles: {
        data: null,
        error: { message: "moment_circles timed out" },
      },
      ownedMoments: { data: null, error: { message: "moments timed out" } },
    });

    const context = await loadConnectedJournalContext(access);

    expect(context.circleName).toBe("Our family");
    expect(context.people.map((person) => person.id)).toEqual(["brian"]);
    expect(context.chrome.notifications).toEqual([]);
  });

  it("does not throw journal context when the Activity scan throws", async () => {
    stubMemberships();
    connectedClient({ throwOn: "moment_circles" });

    const context = await loadConnectedJournalContext(access);

    expect(context.circleName).toBe("Our family");
    expect(context.chrome.notifications).toEqual([]);
  });

  it("retries a required roster query once on a transient family-session error", async () => {
    stubMemberships();
    const rows = requiredRows();
    let peopleAttempts = 0;
    const { from } = connectedClient({
      people: () => {
        peopleAttempts += 1;
        if (peopleAttempts === 1) {
          return {
            data: null,
            error: { code: "PGRST301", message: "JWT expired" },
          };
        }
        return { data: rows.people, error: null };
      },
    });

    const context = await loadConnectedJournalContext(access);

    expect(peopleAttempts).toBe(2);
    expect(from).toHaveBeenCalledWith("people");
    expect(context.people).toEqual([
      expect.objectContaining({ id: "brian", name: "Brian" }),
    ]);
  });

  it("still fails required context after a transient retry misses", async () => {
    stubMemberships();
    const expired = { code: "PGRST301", message: "JWT expired" };
    connectedClient({
      people: () => ({ data: null, error: expired }),
    });

    await expect(loadConnectedJournalContext(access)).rejects.toEqual(expired);
  });

  it("bounds the Activity moment_circles scan to the active circle", async () => {
    stubMemberships();
    const { momentCircles, from } = connectedClient({
      momentCircles: {
        data: [{ moment_id: "italy-video", circle_id: "family" }],
        error: null,
      },
      linkedMoments: {
        data: [
          {
            id: "italy-video",
            recorded_by_membership_id: "membership-calvin",
            kind: "video",
            created_at: "2026-09-11T18:00:00.000Z",
            audience: "family",
          },
        ],
        error: null,
      },
    });

    const context = await loadConnectedJournalContext(access);

    expect(momentCircles.eq).toHaveBeenCalledWith("circle_id", "family");
    expect(momentCircles.in).not.toHaveBeenCalled();
    expect(momentCircles.limit).toHaveBeenCalledWith(80);
    expect(
      from.mock.calls.filter(([table]) => table === "moments"),
    ).toHaveLength(2);
    expect(context.chrome.notifications).toEqual([
      expect.objectContaining({
        id: "moment:italy-video",
        message: "posted a video.",
      }),
    ]);
  });
});
