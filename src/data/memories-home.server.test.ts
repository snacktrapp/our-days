// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const loadConnectedJournalContext = vi.fn();
const loadConnectedMemories = vi.fn();
const loadConnectedMemoryJourney = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("./journal-context.server", () => ({
  loadConnectedJournalContext: (...args: unknown[]) =>
    loadConnectedJournalContext(...args),
}));
vi.mock("./memories.server", () => ({
  loadConnectedMemories: (...args: unknown[]) => loadConnectedMemories(...args),
  loadConnectedMemoryJourney: (...args: unknown[]) =>
    loadConnectedMemoryJourney(...args),
}));

import {
  loadMemoriesJournal,
  loadMemoryJourneyJournal,
  memoriesRefreshSoftFail,
  shouldTrapMemoriesInInterrupt,
} from "./memories-home.server";

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
  people: [],
};

afterEach(() => {
  loadConnectedJournalContext.mockReset();
  loadConnectedMemories.mockReset();
  loadConnectedMemoryJourney.mockReset();
});

describe("memories remount helpers", () => {
  it("does not trap JournalInterrupted when Memories context is aborted", async () => {
    loadConnectedJournalContext.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted."), {
        name: "AbortError",
      }),
    );

    const model = await loadMemoriesJournal(access);

    expect(shouldTrapMemoriesInInterrupt({ name: "AbortError" })).toBe(false);
    expect(model.feature.state).toBe("empty");
    if (model.feature.state !== "empty") throw new Error("expected empty");
    expect(model.feature.title).toBe("These days couldn’t open");
    expect(model.yearsEmptyMessage).toMatch(/Nothing here was lost/);
    expect(model.chrome.title).toBe("Memories");
  });

  it("does not trap JournalInterrupted when the Memories first page misses", async () => {
    loadConnectedJournalContext.mockResolvedValueOnce(context);
    loadConnectedMemories.mockRejectedValueOnce({
      code: "PGRST301",
      message: "JWT expired",
    });

    const model = await loadMemoriesJournal(access);

    expect(model.feature.state).toBe("empty");
    expect(model.chrome.settingsHref).toBe("/settings/family");
  });

  it("does not trap JournalInterrupted when a year journey page 0 misses", async () => {
    loadConnectedJournalContext.mockResolvedValueOnce(context);
    loadConnectedMemoryJourney.mockRejectedValueOnce(
      new Error("Failed to fetch"),
    );

    const model = await loadMemoryJourneyJournal(access, {
      mode: "year",
      year: 2024,
    });

    expect(model.state).toBe("moments");
    if (model.state !== "moments") throw new Error("expected moments");
    expect(model.timeline.refreshDegraded).toBe(true);
    expect(model.timeline.entries[0]?.id).toBe("journal-load-soft-fail");
    expect(model.timeline.paginationError?.retryHref).toBe(
      "/memories/years/2024",
    );
  });

  it("still fails closed for a missing circle", async () => {
    const missing = new Error("Circle is unavailable");
    loadConnectedJournalContext.mockRejectedValueOnce(missing);

    await expect(loadMemoriesJournal(access)).rejects.toBe(missing);
    expect(shouldTrapMemoriesInInterrupt(missing)).toBe(true);
  });

  it("returns the landing model when the remount load succeeds", async () => {
    const landed = memoriesRefreshSoftFail();
    loadConnectedJournalContext.mockResolvedValueOnce(context);
    loadConnectedMemories.mockResolvedValueOnce(landed);

    await expect(loadMemoriesJournal(access)).resolves.toBe(landed);
  });
});
