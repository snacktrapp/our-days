// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const loadConnectedJournalContext = vi.fn();
const loadLocalTrash = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("./journal-context.server", () => ({
  loadConnectedJournalContext: (...args: unknown[]) =>
    loadConnectedJournalContext(...args),
  mapDatabaseAccent: (value: string) => value,
}));
vi.mock("../../config/our-days-environment", () => ({
  localJournalIsEnabled: () => false,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: vi.fn(),
}));

import { loadTrashJournal, shouldTrapTrashInInterrupt } from "./trash.server";

const access = {
  mode: "authenticated" as const,
  membershipId: "membership-brian",
  circleId: "family",
  personId: "brian",
  role: "organizer",
};

afterEach(() => {
  loadConnectedJournalContext.mockReset();
  loadLocalTrash.mockReset();
});

describe("trash remount helper", () => {
  it("does not trap JournalInterrupted when Recently removed misses", async () => {
    loadConnectedJournalContext.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted."), {
        name: "AbortError",
      }),
    );

    await expect(loadTrashJournal(access)).resolves.toEqual({ ok: false });
    expect(shouldTrapTrashInInterrupt({ name: "AbortError" })).toBe(false);
  });

  it("still fails closed for a missing circle", async () => {
    const missing = new Error("Circle is unavailable");
    loadConnectedJournalContext.mockRejectedValueOnce(missing);

    await expect(loadTrashJournal(access)).rejects.toBe(missing);
    expect(shouldTrapTrashInInterrupt(missing)).toBe(true);
  });
});
