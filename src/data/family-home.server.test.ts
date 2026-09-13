// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const loadConnectedJournalContext = vi.fn();
const loadConnectedTimeline = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("./journal-context.server", () => ({
  loadConnectedJournalContext: (...args: unknown[]) =>
    loadConnectedJournalContext(...args),
}));
vi.mock("./moments.server", async () => {
  const actual =
    await vi.importActual<typeof import("./moments.server")>(
      "./moments.server",
    );
  return {
    ...actual,
    loadConnectedTimeline: (...args: unknown[]) =>
      loadConnectedTimeline(...args),
  };
});

import {
  loadFamilyHomeJournal,
  shouldTrapJournalHomeInInterrupt,
} from "./family-home.server";

const access = {
  mode: "authenticated" as const,
  membershipId: "membership-brian",
  circleId: "family",
  personId: "brian",
  role: "organizer",
};

const context = {
  circleName: "Our family",
  circleTimeZone: "America/Los_Angeles",
  today: "2026-09-13",
  chrome: {
    accent: "teal" as const,
    title: "Our family",
    eyebrow: "Our family",
    familyMark: [],
    composer: {
      experience: "connected-family" as const,
      circleId: "family",
      previewToday: "2026-09-13",
      defaultJournalPersonId: "brian",
      recorderPersonId: "brian",
      recordedByName: "Brian",
      journalPeople: [],
      taggablePeople: [],
    },
    settingsHref: "/settings/family",
  },
  people: [
    { id: "brian", name: "Brian", initial: "B", accent: "teal" as const },
  ],
};

const timeline = {
  chrome: {
    ...context.chrome,
    title: "All circles",
    eyebrow: "Circles",
  },
  switcher: [
    {
      kind: "all" as const,
      label: "All circles",
      href: "/family",
      current: true,
    },
  ],
  timelineLabel: "Chronological family moments",
  entries: [
    {
      id: "moment-1",
      entryType: "moment" as const,
    },
  ],
};

describe("Account → Journal remount", () => {
  afterEach(() => {
    loadConnectedJournalContext.mockReset();
    loadConnectedTimeline.mockReset();
  });

  it("does not trap JournalInterrupted when optional Activity context fails", async () => {
    loadConnectedJournalContext.mockRejectedValueOnce({
      message: "moment_circles timed out",
    });

    const model = await loadFamilyHomeJournal(access, {});

    expect(
      shouldTrapJournalHomeInInterrupt({ message: "moment_circles timed out" }),
    ).toBe(false);
    expect(model.chrome.settingsHref).toBe("/settings/family");
    expect(model.switcher.some((item) => item.kind === "all")).toBe(true);
    expect(model.entries[0]).toMatchObject({
      id: "journal-load-soft-fail",
      entryType: "empty-state",
    });
    expect(model.paginationError?.label).toBe("Try opening the journal again");
    expect(loadConnectedTimeline).not.toHaveBeenCalled();
  });

  it("does not trap JournalInterrupted when All-feed remount throws after Account", async () => {
    loadConnectedJournalContext.mockResolvedValueOnce(context);
    loadConnectedTimeline.mockRejectedValueOnce({
      code: "PGRST301",
      message: "JWT expired",
    });

    const model = await loadFamilyHomeJournal(access, {});

    expect(model.chrome.title).toBe("All circles");
    expect(model.chrome.settingsHref).toBe("/settings/family");
    expect(
      model.entries.some((entry) => entry.entryType === "empty-state"),
    ).toBe(true);
    expect(shouldTrapJournalHomeInInterrupt({ message: "JWT expired" })).toBe(
      false,
    );
  });

  it("returns the timeline when the remount load succeeds", async () => {
    loadConnectedJournalContext.mockResolvedValueOnce(context);
    loadConnectedTimeline.mockResolvedValueOnce(timeline);

    const model = await loadFamilyHomeJournal(access, {});

    expect(loadConnectedTimeline).toHaveBeenCalledWith(access, context, {
      pages: 1,
      snapshotAt: undefined,
      allCircles: true,
    });
    expect(model.entries).toEqual(timeline.entries);
  });

  it("still fails closed for a missing circle", async () => {
    const missing = new Error("Circle is unavailable");
    loadConnectedJournalContext.mockRejectedValueOnce(missing);

    await expect(loadFamilyHomeJournal(access, {})).rejects.toBe(missing);
    expect(shouldTrapJournalHomeInInterrupt(missing)).toBe(true);
  });
});
