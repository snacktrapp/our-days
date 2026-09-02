// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: vi.fn(),
}));

import { createOurDaysServerClient } from "@/lib/supabase/server";
import type { ConnectedJournalContext } from "./journal-context.server";
import {
  loadConnectedMemories,
  loadConnectedMemoryJourney,
  parseMemoryYear,
} from "./memories.server";
import type { TimelineRow } from "./moments.server";

const access = {
  mode: "authenticated",
  membershipId: "membership",
  circleId: "circle",
  personId: "parent",
  role: "organizer",
} as const;

const context: ConnectedJournalContext = {
  circleName: "Our family",
  circleTimeZone: "America/Los_Angeles",
  today: "2026-08-30",
  chrome: {
    accent: "teal",
    title: "Our family",
    eyebrow: "Our family",
    familyMark: [],
    memoriesHref: "/memories",
    composer: {
      experience: "connected-family",
      previewToday: "2026-08-30",
      defaultJournalPersonId: "parent",
      recorderPersonId: "parent",
      recordedByName: "Parent",
      journalPeople: [],
      taggablePeople: [],
    },
  },
  people: [
    {
      id: "parent",
      name: "Parent",
      initial: "P",
      accent: "teal",
      roleLabel: "Organizer",
      journalHref: "/people/parent",
    },
  ],
};

function row(overrides: Partial<TimelineRow> = {}): TimelineRow {
  return {
    body: "A quiet morning worth keeping.",
    can_change: true,
    created_at: "2026-08-30T10:00:00Z",
    feed_snapshot_at: "2026-08-30T10:00:01Z",
    journal_person_accent: "sky",
    journal_person_kind: "account",
    journal_person_name: "Parent",
    moment_circle_id: "circle",
    moment_id: "moment-1",
    moment_journal_person_id: "parent",
    moment_kind: "thought",
    moment_title: null,
    occurred_at: null,
    occurred_on: "2022-08-30",
    occurred_timezone: null,
    place_name: null,
    recorder_person_id: "parent",
    recorder_person_name: "Parent",
    revision: 1,
    tagged_people: [],
    time_precision: "date",
    updated_at: "2026-08-30T10:00:00Z",
    ...overrides,
  };
}

describe("connected Memories data", () => {
  it("parses only canonical supported year routes", () => {
    expect(parseMemoryYear("2026")).toBe(2026);
    expect(parseMemoryYear("1")).toBe(1);
    expect(parseMemoryYear("0001")).toBeNull();
    expect(parseMemoryYear("2026-notes")).toBeNull();
    expect(parseMemoryYear("10000")).toBeNull();
  });

  it("builds a count-independent written doorway and descending year links", async () => {
    const longBody = "A family detail worth remembering. ".repeat(20);
    const rpc = vi.fn(async (name: string) =>
      name === "list_memory_years"
        ? {
            data: [{ memory_year: 2026 }, { memory_year: 2022 }],
            error: null,
          }
        : { data: [row({ body: longBody })], error: null },
    );
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const model = await loadConnectedMemories(access, context);

    expect(model.feature).toMatchObject({
      state: "moment",
      personName: "Parent",
      actionLabel: "View entries →",
    });
    if (model.feature.state !== "moment") {
      throw new Error("Expected a written memory doorway");
    }
    expect(Array.from(model.feature.summary)).toHaveLength(180);
    expect(model.feature.summary.endsWith("…")).toBe(true);
    expect(model.years.map(({ year }) => year)).toEqual(["2026", "2022"]);
    expect(rpc).toHaveBeenCalledWith(
      "list_memory_moments",
      expect.objectContaining({ anniversary_month: 8, anniversary_day: 30 }),
    );
  });

  it("renders honest empty landing and journey states", async () => {
    const rpc = vi.fn(async (name: string) =>
      name === "list_memory_years"
        ? { data: [], error: null }
        : { data: [], error: null },
    );
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const landing = await loadConnectedMemories(access, context);
    const journey = await loadConnectedMemoryJourney(access, context, {
      mode: "year",
      year: 1998,
      pages: 1,
    });

    expect(landing.feature.state).toBe("empty");
    expect(landing.years).toEqual([]);
    expect(journey).toMatchObject({
      state: "empty",
      title: "1998",
      emptyState: { title: "No moments from this year" },
    });

    const future = await loadConnectedMemoryJourney(access, context, {
      mode: "year",
      year: 9999,
      pages: 1,
    });
    expect(future).toMatchObject({
      state: "empty",
      emptyState: { title: "This year hasn’t happened yet" },
    });
  });

  it("offers bounded keyset navigation without silently truncating older chapters", async () => {
    const rpc = vi.fn(async (name: string, args: { before_year?: number }) => {
      if (name !== "list_memory_years") return { data: [], error: null };
      return args.before_year === undefined
        ? {
            data: Array.from({ length: 41 }, (_, index) => ({
              memory_year: 2026 - index,
            })),
            error: null,
          }
        : { data: [{ memory_year: 1986 }], error: null };
    });
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const newest = await loadConnectedMemories(access, context);
    const earlier = await loadConnectedMemories(access, context, {
      beforeYear: 1987,
    });

    expect(newest.years).toHaveLength(40);
    expect(newest.yearNavigation?.earlierHref).toBe(
      "/memories?beforeYear=1987",
    );
    expect(earlier.years.map(({ year }) => year)).toEqual(["1986"]);
    expect(earlier.yearNavigation?.newestHref).toBe("/memories");
    expect(rpc).toHaveBeenCalledWith("list_memory_years", {
      circle_id: "circle",
      before_year: 1987,
      page_size: 41,
    });
  });

  it("keeps loaded pages and offers an in-route retry after a later RPC error", async () => {
    const firstPage = Array.from({ length: 21 }, (_, index) =>
      row({
        moment_id: `moment-${String(99 - index).padStart(2, "0")}`,
        occurred_on: "2018-02-03",
      }),
    );
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: new Error("private detail"),
      });
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const model = await loadConnectedMemoryJourney(access, context, {
      mode: "anniversary",
      pages: 2,
    });

    expect(model.state).toBe("moments");
    if (model.state !== "moments") throw new Error("Expected moments");
    expect(model.timeline.pagination).toBeUndefined();
    expect(model.timeline.paginationError?.retryHref).toBe(
      "/memories/on-this-day?pages=2&snapshot=2026-08-30T10%3A00%3A01Z&anniversary=08-30",
    );
    expect(
      model.timeline.entries.filter((entry) => entry.entryType === "moment"),
    ).toHaveLength(20);
  });

  it("freezes On This Day to the original snapshot across circle midnight", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row()], error: null });
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const model = await loadConnectedMemoryJourney(
      access,
      {
        ...context,
        circleTimeZone: "America/Los_Angeles",
        today: "2026-08-31",
      },
      {
        mode: "anniversary",
        pages: 1,
        snapshotAt: "2026-08-31T06:30:00.000Z",
      },
    );

    expect(model.title).toBe("August 30");
    expect(rpc).toHaveBeenCalledWith(
      "list_memory_moments",
      expect.objectContaining({ anniversary_month: 8, anniversary_day: 30 }),
    );
  });

  it("carries the original anniversary when the first snapshot crosses circle midnight", async () => {
    const firstPage = Array.from({ length: 21 }, (_, index) =>
      row({
        feed_snapshot_at: "2026-08-31T07:30:00.000Z",
        moment_id: `moment-${index}`,
      }),
    );
    const rpc = vi.fn().mockResolvedValue({ data: firstPage, error: null });
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const first = await loadConnectedMemoryJourney(access, context, {
      mode: "anniversary",
      pages: 1,
    });

    expect(first.state).toBe("moments");
    if (first.state !== "moments") throw new Error("Expected moments");
    expect(first.title).toBe("August 30");
    expect(first.timeline.pagination?.nextHref).toBe(
      "/memories/on-this-day?pages=2&snapshot=2026-08-31T07%3A30%3A00.000Z&anniversary=08-30",
    );

    rpc.mockClear();
    await loadConnectedMemoryJourney(
      access,
      { ...context, today: "2026-08-31" },
      {
        mode: "anniversary",
        pages: 1,
        snapshotAt: "2026-08-31T07:30:00.000Z",
        anniversaryKey: "08-30",
      },
    );
    expect(rpc).toHaveBeenCalledWith(
      "list_memory_moments",
      expect.objectContaining({ anniversary_month: 8, anniversary_day: 30 }),
    );
  });

  it("builds the private milestone archive with stable keyset navigation", async () => {
    const milestoneRows = Array.from({ length: 21 }, (_, index) =>
      row({
        moment_id: `milestone-${String(99 - index).padStart(2, "0")}`,
        moment_kind: "milestone",
        moment_title: `Chapter ${index + 1}`,
        occurred_on: "2018-02-03",
      }),
    );
    const rpc = vi.fn().mockResolvedValue({ data: milestoneRows, error: null });
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const model = await loadConnectedMemoryJourney(access, context, {
      mode: "milestones",
      pages: 1,
    });

    expect(rpc).toHaveBeenCalledWith(
      "list_milestone_memories",
      expect.objectContaining({
        circle_id: "circle",
        page_size: 21,
        snapshot_at: undefined,
      }),
    );
    expect(model).toMatchObject({
      state: "moments",
      eyebrow: "Family milestones",
      title: "Milestones",
    });
    if (model.state !== "moments") throw new Error("Expected milestones");
    expect(model.timeline.timelineLabel).toBe(
      "Family milestones in reverse chronological order",
    );
    expect(model.timeline.pagination).toEqual({
      nextHref:
        "/memories/milestones?pages=2&snapshot=2026-08-30T10%3A00%3A01Z",
      label: "Show earlier milestones",
    });
    expect(
      model.timeline.entries.filter((entry) => entry.entryType === "moment"),
    ).toHaveLength(20);
  });

  it("returns a truthful empty milestone archive", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const model = await loadConnectedMemoryJourney(access, context, {
      mode: "milestones",
      pages: 1,
    });

    expect(model).toMatchObject({
      state: "empty",
      title: "Milestones",
      emptyState: { title: "No milestones have been marked yet" },
    });
  });

  it("carries the milestone cursor and snapshot across a requested continuation", async () => {
    const firstPage = Array.from({ length: 21 }, (_, index) =>
      row({
        moment_id: `milestone-${String(99 - index).padStart(2, "0")}`,
        moment_kind: "milestone",
        moment_title: `Milestone ${index + 1}`,
        occurred_on: "2010-01-01",
      }),
    );
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: [
          row({
            moment_id: "milestone-79",
            moment_kind: "milestone",
            moment_title: "The last milestone",
            occurred_on: "2010-01-01",
          }),
        ],
        error: null,
      });
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const model = await loadConnectedMemoryJourney(access, context, {
      mode: "milestones",
      pages: 2,
    });

    expect(rpc).toHaveBeenNthCalledWith(2, "list_milestone_memories", {
      circle_id: "circle",
      cursor_occurred_on: "2010-01-01",
      cursor_has_precise_time: false,
      cursor_occurred_at: undefined,
      cursor_moment_id: "milestone-80",
      page_size: 21,
      snapshot_at: "2026-08-30T10:00:01Z",
    });
    expect(model.state).toBe("moments");
    if (model.state !== "moments") throw new Error("Expected milestones");
    expect(model.timeline.pagination).toBeUndefined();
    expect(
      model.timeline.entries.filter((entry) => entry.entryType === "moment"),
    ).toHaveLength(21);
  });

  it("keeps milestone pages and offers an in-route retry after a later RPC error", async () => {
    const firstPage = Array.from({ length: 21 }, (_, index) =>
      row({
        moment_id: `milestone-${String(99 - index).padStart(2, "0")}`,
        moment_kind: "milestone",
        moment_title: `Milestone ${index + 1}`,
        occurred_on: "2010-01-01",
      }),
    );
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: new Error("private detail"),
      });
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const model = await loadConnectedMemoryJourney(access, context, {
      mode: "milestones",
      pages: 2,
    });

    expect(model.state).toBe("moments");
    if (model.state !== "moments") throw new Error("Expected milestones");
    expect(model.timeline.paginationError?.retryHref).toBe(
      "/memories/milestones?pages=2&snapshot=2026-08-30T10%3A00%3A01Z",
    );
  });

  it("rejects abusive cumulative page counts before making a database call", async () => {
    const rpc = vi.fn();
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    await expect(
      loadConnectedMemoryJourney(access, context, {
        mode: "year",
        year: 2026,
        pages: 26,
      }),
    ).rejects.toThrow("Timeline request is too large");
    expect(rpc).not.toHaveBeenCalled();
  });
});
