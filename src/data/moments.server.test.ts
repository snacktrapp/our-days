// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: vi.fn(),
}));

import { createOurDaysServerClient } from "@/lib/supabase/server";
import {
  buildTimelineEntries,
  loadConnectedTimeline,
  mapTimelineRow,
} from "./moments.server";

type Row = Parameters<typeof mapTimelineRow>[0];

function row(overrides: Partial<Row> = {}): Row {
  return {
    body: "A small thought.",
    can_change: true,
    created_at: "2026-08-30T10:00:00Z",
    feed_snapshot_at: "2026-08-30T10:00:01Z",
    journal_person_accent: "sage",
    journal_person_kind: "managed",
    journal_person_name: "Child",
    latitude: null,
    longitude: null,
    moment_circle_id: "circle",
    moment_id: "moment-2",
    moment_journal_person_id: "child",
    occurred_at: null,
    occurred_on: "2026-08-28",
    occurred_timezone: null,
    recorder_person_id: "parent",
    recorder_person_name: "Parent",
    revision: 3,
    time_precision: "date",
    updated_at: "2026-08-30T10:00:00Z",
    ...overrides,
  };
}

describe("connected timeline mapping", () => {
  it("maps database accents explicitly and never invents a time for date-only history", () => {
    const moment = mapTimelineRow(row(), "2026-08-30");
    expect(moment.personAccent).toBe("moss");
    expect(moment.displayTime).toBeUndefined();
    expect(moment.kicker).toBe("Recorded by Parent");
    expect(moment.revision).toBe(3);
    expect(moment.maxOccurredOn).toBe("2026-08-30");
  });

  it("formats a precise instant in its recorded timezone", () => {
    const moment = mapTimelineRow(
      row({
        occurred_at: "2026-08-28T17:15:00Z",
        occurred_timezone: "America/Los_Angeles",
        time_precision: "minute",
      }),
      "2026-08-30",
    );
    expect(moment.displayTime).toBe("10:15 AM");
  });

  it("maps milestones and manual places without inventing age or map precision", () => {
    const milestone = mapTimelineRow(
      row({
        moment_kind: "milestone",
        moment_title: "First library card",
        place_name: "Cedar Park",
        body: "A very proud afternoon.",
        occurred_on: "2024-04-12",
      }),
      "2026-08-30",
    );
    const location = mapTimelineRow(
      row({
        moment_kind: "location",
        place_name: "Ocean overlook",
        body: "A windy picnic.",
      }),
      "2026-08-30",
    );
    expect(milestone).toMatchObject({
      kind: "milestone",
      milestone: "First library card",
      placeName: "Cedar Park",
      yearLabel: "2024",
    });
    expect(milestone).not.toHaveProperty("ageLabel");
    expect(location).toMatchObject({
      kind: "location",
      place: "Ocean overlook",
      mapLabel: "Remembered here",
    });
  });

  it("maps tag identity while keeping closed conversations out of the feed row", () => {
    const moment = mapTimelineRow(
      row({
        tagged_people: [
          { id: "person-2", name: "Molly" },
          { id: "person-3", name: "Avery" },
        ],
      }),
      "2026-08-30",
    );
    expect(moment.taggedPeopleLabel).toBe("Molly, Avery");
    expect(moment.conversation).toEqual({ notes: [], reactions: [] });
  });

  it("maps a connected photo to the same-origin private delivery route", () => {
    const moment = mapTimelineRow(
      row({
        moment_id: "10000000-0000-4000-8000-000000000099",
        moment_kind: "photo",
        journal_person_name: "Molly",
        recorder_person_id: "child",
        recorder_person_name: "Molly",
        body: "A windy afternoon.",
      }),
      "2026-08-30",
    );
    expect(moment).toMatchObject({
      kind: "photo",
      kicker: "A photo",
      image: {
        src: "/api/media/moments/10000000-0000-4000-8000-000000000099",
        alt: "Photo in Molly’s journal from Aug 28, 2026",
        delivery: "private",
      },
    });
  });

  it("maps a connected video to the same-origin private byte-range route", () => {
    const moment = mapTimelineRow(
      row({
        moment_id: "10000000-0000-4000-8000-000000000098",
        moment_kind: "video",
        journal_person_name: "Molly",
        recorder_person_id: "child",
        recorder_person_name: "Molly",
        body: "First steps across the kitchen.",
      }),
      "2026-08-30",
    );
    expect(moment).toMatchObject({
      kind: "video",
      kicker: "A video",
      video: {
        src: "/api/media/videos/10000000-0000-4000-8000-000000000098",
      },
    });
  });

  it("builds visible dates once without relative elapsed-gap pills and withholds the ending while more exists", () => {
    const today = mapTimelineRow(
      row({ moment_id: "moment-today", occurred_on: "2026-08-30" }),
      "2026-08-30",
    );
    const older = mapTimelineRow(
      row({ moment_id: "moment-1", occurred_on: "2021-04-03" }),
      "2026-08-30",
    );
    const entries = buildTimelineEntries([today, older], "2026-08-30", true);
    expect(entries.map((entry) => entry.entryType)).toEqual([
      "date-marker",
      "moment",
      "date-marker",
      "moment",
    ]);
    expect(
      entries
        .filter((entry) => entry.entryType === "date-marker")
        .map((entry) => (entry.entryType === "date-marker" ? entry.label : "")),
    ).toEqual(["Today", "Apr 3, 2021"]);
    expect(entries.some((entry) => entry.entryType === "elapsed-gap")).toBe(
      false,
    );
  });

  it("keeps empty journals honest and closes a completed family feed with the earliest-entry marker", () => {
    expect(buildTimelineEntries([], "2026-08-30", false, "Child")).toEqual([
      expect.objectContaining({
        entryType: "empty-state",
        title: "A story ready to begin",
      }),
    ]);
    const entries = buildTimelineEntries(
      [mapTimelineRow(row(), "2026-08-30")],
      "2026-08-30",
      false,
    );
    expect(entries.at(-1)).toMatchObject({
      entryType: "end-message",
      markerLabel: "The beginning",
      message: "You’ve reached the earliest moment kept here.",
    });
  });

  it("retains the loaded page and offers an inline retry when an older RPC fails", async () => {
    const firstPage = Array.from({ length: 21 }, (_, index) =>
      row({ moment_id: `moment-${String(99 - index).padStart(2, "0")}` }),
    );
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: new Error("private detail"),
      });
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const timeline = await loadConnectedTimeline(
      {
        mode: "authenticated",
        membershipId: "membership",
        circleId: "circle",
        personId: "parent",
        role: "organizer",
      },
      {
        circleName: "Our family",
        circleTimeZone: "America/Los_Angeles",
        today: "2026-08-30",
        chrome: {
          accent: "teal",
          title: "Our family",
          eyebrow: "Our family",
          familyMark: [],
          composer: {
            experience: "connected-written",
            previewToday: "2026-08-30",
            defaultJournalPersonId: "parent",
            recorderPersonId: "parent",
            recordedByName: "Parent",
            journalPeople: [],
            taggablePeople: [],
          },
        },
        people: [],
      },
      { pages: 2 },
    );

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(timeline.pagination).toBeUndefined();
    expect(timeline.paginationError).toEqual({
      retryHref: "/family?pages=2&snapshot=2026-08-30T10%3A00%3A01Z",
      message:
        "Earlier days couldn’t be opened. The moments already here are still safe.",
      label: "Try opening earlier days again",
    });
    expect(
      timeline.entries.filter((entry) => entry.entryType === "moment"),
    ).toHaveLength(20);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "list_timeline_moments",
      expect.objectContaining({ snapshot_at: "2026-08-30T10:00:01Z" }),
    );
  });

  it("defaults Add Moment to the writable personal journal being viewed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const timeline = await loadConnectedTimeline(
      {
        mode: "authenticated",
        membershipId: "membership",
        circleId: "circle",
        personId: "parent",
        role: "organizer",
      },
      {
        circleName: "Our family",
        circleTimeZone: "America/Los_Angeles",
        today: "2026-08-30",
        chrome: {
          accent: "teal",
          title: "Our family",
          eyebrow: "Our family",
          familyMark: [],
          composer: {
            experience: "connected-written",
            previewToday: "2026-08-30",
            defaultJournalPersonId: "parent",
            recorderPersonId: "parent",
            recordedByName: "Parent",
            journalPeople: [
              {
                id: "parent",
                name: "Parent",
                initial: "P",
                accent: "teal",
                contextLabel: "You",
              },
              {
                id: "child",
                name: "Child",
                initial: "C",
                accent: "moss",
                contextLabel: "Managed journal",
              },
            ],
            taggablePeople: [],
          },
        },
        people: [
          {
            id: "child",
            name: "Child",
            initial: "C",
            accent: "moss",
            roleLabel: "Managed journal",
            journalHref: "/people/child",
          },
        ],
      },
      { journalPersonId: "child", pages: 1 },
    );

    expect(timeline.chrome.composer.defaultJournalPersonId).toBe("child");
    expect(timeline.chrome.composer.recorderPersonId).toBe("parent");
    expect(timeline.switcher).toEqual([
      { label: "Family", href: "/family", current: false },
      {
        label: "Child",
        href: "/people/child",
        current: true,
      },
    ]);
  });

  it("continues beyond twenty cumulative pages without repeating page twenty", async () => {
    const fullPage = Array.from({ length: 21 }, (_, index) =>
      row({ moment_id: `moment-${String(99 - index).padStart(2, "0")}` }),
    );
    const rpc = vi.fn().mockResolvedValue({ data: fullPage, error: null });
    vi.mocked(createOurDaysServerClient).mockResolvedValue({ rpc } as never);

    const timeline = await loadConnectedTimeline(
      {
        mode: "authenticated",
        membershipId: "membership",
        circleId: "circle",
        personId: "parent",
        role: "organizer",
      },
      {
        circleName: "Our family",
        circleTimeZone: "America/Los_Angeles",
        today: "2026-08-30",
        chrome: {
          accent: "teal",
          title: "Our family",
          eyebrow: "Our family",
          familyMark: [],
          composer: {
            experience: "connected-written",
            previewToday: "2026-08-30",
            defaultJournalPersonId: "parent",
            recorderPersonId: "parent",
            recordedByName: "Parent",
            journalPeople: [],
            taggablePeople: [],
          },
        },
        people: [],
      },
      { pages: 21 },
    );

    expect(rpc).toHaveBeenCalledTimes(21);
    expect(timeline.pagination?.nextHref).toBe(
      "/family?pages=22&snapshot=2026-08-30T10%3A00%3A01Z",
    );
  });
});
