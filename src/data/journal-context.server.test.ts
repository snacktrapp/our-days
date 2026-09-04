// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: vi.fn(),
}));

import {
  buildActivityNotifications,
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
