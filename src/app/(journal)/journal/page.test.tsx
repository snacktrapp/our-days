import { describe, expect, it, vi } from "vitest";
import JournalPage from "./page";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/journal-access", () => ({ requireJournalAccess: access }));
vi.mock("@/fixtures/design-preview/timelines.server", () => ({
  getFamilyTimelineFixture: () => ({
    chrome: { composer: { recorderPersonId: "brian" } },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(href);
  },
}));

describe("Journal destination", () => {
  it("resolves Just me using the signed-in identity, not a browsed person's ID", async () => {
    access.mockResolvedValue({ mode: "authenticated", personId: "alex" });
    await expect(
      JournalPage({ searchParams: Promise.resolve({ view: "you" }) }),
    ).rejects.toThrow("/people/alex");
  });
  it("resolves Just me in the detached design preview", async () => {
    access.mockResolvedValue({ mode: "preview" });
    await expect(
      JournalPage({ searchParams: Promise.resolve({ view: "you" }) }),
    ).rejects.toThrow("/people/brian");
  });
  it("keeps legacy journal links pointing to All circles", async () => {
    access.mockResolvedValue({ mode: "authenticated", personId: "alex" });
    await expect(
      JournalPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("/family");
  });
});
