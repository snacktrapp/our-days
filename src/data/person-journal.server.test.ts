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
  loadPersonJournal,
  shouldTrapPersonJournalInInterrupt,
} from "./person-journal.server";

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
    { id: "calvin", name: "Calvin", initial: "C", accent: "coral" as const },
  ],
};

const timeline = {
  chrome: {
    ...context.chrome,
    accent: "coral" as const,
    title: "Calvin",
    eyebrow: "Person",
  },
  switcher: [
    {
      kind: "person" as const,
      label: "Calvin",
      href: "/people/calvin",
      current: true,
    },
  ],
  timelineLabel: "Chronological moments for Calvin",
  entries: [
    {
      id: "moment-1",
      entryType: "moment" as const,
    },
  ],
};

function abortError() {
  return Object.assign(new Error("The operation was aborted."), {
    name: "AbortError",
  });
}

describe("People journal remount", () => {
  afterEach(() => {
    loadConnectedJournalContext.mockReset();
    loadConnectedTimeline.mockReset();
  });

  it("does not trap JournalInterrupted on abort or transient timeline miss", async () => {
    loadConnectedJournalContext.mockResolvedValueOnce(context);
    loadConnectedTimeline.mockRejectedValueOnce(abortError());

    const aborted = await loadPersonJournal(access, { personId: "calvin" });

    expect(shouldTrapPersonJournalInInterrupt(abortError())).toBe(false);
    expect(aborted?.chrome.title).toBe("Calvin");
    expect(aborted?.chrome.settingsHref).toBe("/settings/family");
    expect(aborted?.personalIntro?.title).toBe("Calvin’s journal");
    expect(aborted?.entries[0]).toMatchObject({
      id: "journal-load-soft-fail",
      entryType: "empty-state",
    });
    expect(aborted?.paginationError).toMatchObject({
      retryHref: "/people/calvin",
      label: "Try opening the journal again",
    });

    loadConnectedJournalContext.mockResolvedValueOnce(context);
    loadConnectedTimeline.mockRejectedValueOnce({
      code: "PGRST301",
      message: "JWT expired",
    });

    const transient = await loadPersonJournal(access, { personId: "calvin" });

    expect(shouldTrapPersonJournalInInterrupt({ message: "JWT expired" })).toBe(
      false,
    );
    expect(transient?.entries[0]).toMatchObject({
      id: "journal-load-soft-fail",
      entryType: "empty-state",
    });
    expect(transient?.paginationError?.retryHref).toBe("/people/calvin");
  });

  it("does not trap JournalInterrupted when remount context is aborted", async () => {
    loadConnectedJournalContext.mockRejectedValueOnce(abortError());

    const model = await loadPersonJournal(access, { personId: "calvin" });

    expect(model?.entries[0]).toMatchObject({
      id: "journal-load-soft-fail",
      entryType: "empty-state",
    });
    expect(model?.paginationError?.retryHref).toBe("/people/calvin");
    expect(loadConnectedTimeline).not.toHaveBeenCalled();
  });

  it("returns the timeline when the remount load succeeds", async () => {
    loadConnectedJournalContext.mockResolvedValueOnce(context);
    loadConnectedTimeline.mockResolvedValueOnce(timeline);

    const model = await loadPersonJournal(access, {
      personId: "calvin",
      pages: "2",
      snapshotAt: "2026-09-13T00:00:00.000Z",
    });

    expect(loadConnectedTimeline).toHaveBeenCalledWith(access, context, {
      journalPersonId: "calvin",
      pages: 2,
      snapshotAt: "2026-09-13T00:00:00.000Z",
    });
    expect(model?.entries).toEqual(timeline.entries);
  });

  it("still fails closed for a missing circle or member", async () => {
    const missingCircle = new Error("Circle is unavailable");
    loadConnectedJournalContext.mockRejectedValueOnce(missingCircle);

    await expect(
      loadPersonJournal(access, { personId: "calvin" }),
    ).rejects.toBe(missingCircle);
    expect(shouldTrapPersonJournalInInterrupt(missingCircle)).toBe(true);

    const missingMember = new Error("Member profile is unavailable");
    loadConnectedJournalContext.mockRejectedValueOnce(missingMember);

    await expect(
      loadPersonJournal(access, { personId: "calvin" }),
    ).rejects.toBe(missingMember);
    expect(shouldTrapPersonJournalInInterrupt(missingMember)).toBe(true);
    expect(loadConnectedTimeline).not.toHaveBeenCalled();
  });

  it("returns not-found when the person is missing from the roster", async () => {
    loadConnectedJournalContext.mockResolvedValueOnce(context);

    await expect(
      loadPersonJournal(access, { personId: "unknown" }),
    ).resolves.toBeNull();
    expect(loadConnectedTimeline).not.toHaveBeenCalled();
  });
});
