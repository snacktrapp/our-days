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
  familyHomeRefreshSoftFail,
  loadFamilyHomeChrome,
  loadFamilyHomeFirstMoment,
  loadFamilyHomeJournal,
  loadFamilyHomeRemainder,
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
    {
      id: "brian",
      name: "Brian",
      initial: "B",
      accent: "teal" as const,
      roleLabel: "Organizer",
      journalHref: "/people/brian",
    },
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

  it("does not trap JournalInterrupted when All-circles refresh misses the first page", async () => {
    loadConnectedJournalContext.mockResolvedValueOnce(context);
    loadConnectedTimeline.mockRejectedValueOnce({
      message: "Failed to fetch",
    });

    const model = await loadFamilyHomeJournal(access, {});

    expect(shouldTrapJournalHomeInInterrupt(new Error("Failed to fetch"))).toBe(
      false,
    );
    expect(model.refreshDegraded).toBe(true);
    expect(model.chrome.title).toBe("All circles");
    expect(model.entries[0]).toMatchObject({
      id: "journal-load-soft-fail",
      entryType: "empty-state",
    });
    expect(model.paginationError?.retryHref).toBe("/family");
  });

  it("soft-fails an All-circles refresh when journal access is still warming", () => {
    const model = familyHomeRefreshSoftFail(true);

    expect(
      shouldTrapJournalHomeInInterrupt({
        name: "AbortError",
        message: "The operation was aborted.",
      }),
    ).toBe(false);
    expect(model.refreshDegraded).toBe(true);
    expect(model.chrome.title).toBe("All circles");
    expect(model.entries[0]).toMatchObject({
      id: "journal-load-soft-fail",
      entryType: "empty-state",
    });
    expect(model.paginationError?.retryHref).toBe("/family");
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

  it("opens chrome without waiting for Activity or the first timeline page", async () => {
    loadConnectedJournalContext.mockResolvedValueOnce(context);

    const opened = await loadFamilyHomeChrome(access, {});

    expect(loadConnectedJournalContext).toHaveBeenCalledWith(access, {
      includeActivity: false,
    });
    expect(loadConnectedTimeline).not.toHaveBeenCalled();
    expect(opened.context).toBe(context);
    expect(opened.model.chrome.title).toBe("All circles");
    expect(opened.model.entries).toEqual([]);
    expect(opened.model.refreshDegraded).toBeUndefined();
  });

  it("loads only the first moment for the opening card", async () => {
    loadConnectedTimeline.mockResolvedValueOnce(timeline);

    const model = await loadFamilyHomeFirstMoment(access, context, {});

    expect(loadConnectedTimeline).toHaveBeenCalledWith(access, context, {
      pages: 1,
      snapshotAt: undefined,
      allCircles: true,
      enrichLimit: 1,
      omitCompletion: true,
      omitPagination: true,
    });
    expect(model.entries).toEqual(timeline.entries);
  });

  it("does not trap JournalInterrupted when the remainder after the first card misses", async () => {
    loadConnectedTimeline.mockRejectedValueOnce({
      message: "Failed to fetch",
    });

    const model = await loadFamilyHomeRemainder(access, context, {});

    expect(shouldTrapJournalHomeInInterrupt(new Error("Failed to fetch"))).toBe(
      false,
    );
    expect(model.entries).toEqual([]);
    expect(model.paginationError?.label).toBe("Try opening earlier days again");
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
