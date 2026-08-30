// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  createClient: vi.fn(),
  getClaims: vi.fn(),
  isPreview: vi.fn(),
  limit: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/design-preview.server", () => ({
  isDesignPreviewEnabled: mocks.isPreview,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));

import {
  readJournalAccessState,
  requireJournalAccess,
  requirePreviewFixtureAccess,
} from "./journal-access";

function membershipQuery() {
  const chain = {
    eq: vi.fn(() => chain),
    limit: mocks.limit,
    order: vi.fn(() => chain),
    select: vi.fn(() => chain),
  };
  return chain;
}

describe("journal access boundary", () => {
  beforeEach(() => {
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "supabase");
    mocks.isPreview.mockReturnValue(false);
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-a" } },
      error: null,
    });
    mocks.limit.mockResolvedValue({
      data: [
        {
          circle_id: "circle-a",
          id: "membership-a",
          person_id: "person-a",
          role: "organizer",
        },
      ],
      error: null,
    });
    const query = membershipQuery();
    mocks.createClient.mockResolvedValue({
      auth: { getClaims: mocks.getClaims },
      from: vi.fn(() => query),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("preserves the isolated design preview without creating a client", async () => {
    mocks.isPreview.mockReturnValueOnce(true);

    await expect(requireJournalAccess()).resolves.toEqual({ mode: "preview" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("fails detached environments closed", async () => {
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "detached");

    await expect(requireJournalAccess()).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in",
    );
  });

  it("requires a valid server-verified identity", async () => {
    mocks.getClaims.mockResolvedValueOnce({ data: null, error: new Error() });

    await expect(requireJournalAccess()).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in",
    );
  });

  it("returns only a current live membership", async () => {
    await expect(requireJournalAccess()).resolves.toEqual({
      mode: "authenticated",
      circleId: "circle-a",
      membershipId: "membership-a",
      personId: "person-a",
      role: "organizer",
    });
  });

  it("never lets an authenticated route serialize the design fixture", async () => {
    await expect(requirePreviewFixtureAccess()).rejects.toThrow(
      "NEXT_REDIRECT:/access-unavailable",
    );
  });

  it("keeps an authenticated identity without circle membership out", async () => {
    mocks.limit.mockResolvedValueOnce({ data: [], error: null });

    await expect(requireJournalAccess()).rejects.toThrow(
      "NEXT_REDIRECT:/access-unavailable",
    );
  });

  it("distinguishes anonymous and authenticated no-access states", async () => {
    mocks.getClaims.mockResolvedValueOnce({ data: null, error: null });
    await expect(readJournalAccessState()).resolves.toEqual({
      mode: "anonymous",
    });

    mocks.limit.mockResolvedValueOnce({ data: [], error: null });
    await expect(readJournalAccessState()).resolves.toEqual({
      mode: "no-access",
    });
  });

  it("does not turn a database failure into an access decision", async () => {
    mocks.limit.mockResolvedValueOnce({
      data: null,
      error: new Error("database unavailable"),
    });

    await expect(requireJournalAccess()).rejects.toThrow(
      "database unavailable",
    );
  });
});
