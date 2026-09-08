// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  origin: vi.fn(),
  memberships: vi.fn(),
  access: vi.fn(),
  create: vi.fn(),
  from: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "https://journal.example.com" }),
}));
vi.mock("@/lib/auth/same-origin", () => ({
  isExpectedMutationOrigin: mocks.origin,
}));
vi.mock("@/lib/auth/journal-access", () => ({
  readJournalCircleMemberships: mocks.memberships,
  requireJournalAccess: mocks.access,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: async () => ({ from: mocks.from }),
}));
vi.mock("@/features/moments/moment-actions", () => ({
  createFamilyMomentAction: mocks.create,
}));
vi.mock("../../../config/our-days-environment", () => ({
  localJournalIsEnabled: () => false,
}));

import { shareInsightMomentAction } from "./insight-share-actions";
import { formatSharedInsightMoment } from "./insight-share";

describe("shareInsightMomentAction", () => {
  beforeEach(() => {
    mocks.origin.mockReturnValue(true);
    mocks.memberships.mockResolvedValue([
      {
        membershipId: "m1",
        circleId: "20000000-0000-4000-8000-000000000001",
        personId: "30000000-0000-4000-8000-000000000001",
        role: "member",
      },
    ]);
    mocks.access.mockResolvedValue({
      mode: "authenticated",
      membershipId: "m1",
      circleId: "20000000-0000-4000-8000-000000000001",
      personId: "30000000-0000-4000-8000-000000000001",
      role: "member",
    });
    mocks.create.mockResolvedValue({
      ok: true,
      message: "Moment saved.",
      momentId: "shared-1",
    });
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              kind: "insight",
              title: "Huberman Lab",
              body: "Prayer steadies the mind.",
              audience: "just_me",
              journal_person_id: "30000000-0000-4000-8000-000000000001",
            },
            error: null,
          }),
        }),
      }),
    });
  });

  it("creates a user-authored thought with the Insight copy", async () => {
    const result = await shareInsightMomentAction({
      momentId: "60000000-0000-4000-8000-000000000008",
      circleIds: ["20000000-0000-4000-8000-000000000001"],
    });
    expect(result).toEqual({
      ok: true,
      message: "Shared to your group.",
      momentId: "shared-1",
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "thought",
        audience: "family",
        journalPersonId: "30000000-0000-4000-8000-000000000001",
        body: formatSharedInsightMoment(
          "Prayer steadies the mind.",
          "Huberman Lab",
        ),
        circleIds: ["20000000-0000-4000-8000-000000000001"],
      }),
    );
  });
});
