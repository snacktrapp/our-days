// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getHeaders: vi.fn(),
  revalidatePath: vi.fn(),
  requireAccess: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.getHeaders }));
vi.mock("@/lib/auth/journal-access", () => ({
  requireJournalAccess: mocks.requireAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));

import {
  createWrittenMomentAction,
  restoreWrittenMomentAction,
  trashWrittenMomentAction,
  updateWrittenMomentAction,
} from "./moment-actions";

const personId = "30000000-0000-4000-8000-000000000001";
const momentId = "60000000-0000-4000-8000-000000000001";

describe("written moment actions", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    mocks.getHeaders.mockResolvedValue(
      new Headers({ origin: "https://journal.example.com" }),
    );
    mocks.requireAccess.mockResolvedValue({
      mode: "authenticated",
      membershipId: "membership-a",
      circleId: "20000000-0000-4000-8000-000000000001",
      personId,
      role: "member",
    });
    mocks.rpc.mockResolvedValue({ data: momentId, error: null });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("derives the circle and recorder from access while sending only reviewed fields", async () => {
    await expect(
      createWrittenMomentAction({
        journalPersonId: personId,
        body: "  A literal <script> thought.  ",
        occurredOn: "2026-08-28",
        occurredAt: null,
        occurredTimezone: null,
      }),
    ).resolves.toMatchObject({ ok: true, momentId });

    expect(mocks.rpc).toHaveBeenCalledWith("create_written_moment", {
      circle_id: "20000000-0000-4000-8000-000000000001",
      journal_person_id: personId,
      body: "A literal <script> thought.",
      occurred_on: "2026-08-28",
      occurred_at: undefined,
      occurred_timezone: undefined,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/people/${personId}`);
  });

  it("fails cross-origin requests before reading access or touching Supabase", async () => {
    mocks.getHeaders.mockResolvedValueOnce(
      new Headers({ origin: "https://attacker.invalid" }),
    );
    await expect(
      createWrittenMomentAction({
        journalPersonId: personId,
        body: "No mutation.",
        occurredOn: "2026-08-28",
        occurredAt: null,
        occurredTimezone: null,
      }),
    ).resolves.toEqual({
      ok: false,
      message: "That request could not be verified.",
    });
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects malformed input before opening a database client", async () => {
    await expect(
      createWrittenMomentAction({
        journalPersonId: personId,
        body: "   ",
        occurredOn: "not-a-date",
        occurredAt: null,
        occurredTimezone: null,
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("preserves optimistic revision and maps a stale edit to calm recovery copy", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "Moment changed elsewhere" },
    });
    await expect(
      updateWrittenMomentAction({
        momentId,
        revision: 4,
        body: "A current draft.",
        occurredOn: "2026-08-28",
        occurredAt: null,
        occurredTimezone: null,
      }),
    ).resolves.toEqual({
      ok: false,
      message: "This moment changed elsewhere. Reopen it before editing again.",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("update_written_moment", {
      moment_id: momentId,
      expected_revision: 4,
      body: "A current draft.",
      occurred_on: "2026-08-28",
      occurred_at: undefined,
      occurred_timezone: undefined,
    });
  });

  it("uses the same revision-checked RPC for trash and restore", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: 3, error: null })
      .mockResolvedValueOnce({ data: 4, error: null });
    await expect(
      trashWrittenMomentAction({ momentId, revision: 2 }),
    ).resolves.toMatchObject({ ok: true, revision: 3 });
    await expect(
      restoreWrittenMomentAction({ momentId, revision: 3 }),
    ).resolves.toMatchObject({ ok: true, revision: 4 });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "set_written_moment_trashed", {
      moment_id: momentId,
      expected_revision: 2,
      trashed: true,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "set_written_moment_trashed", {
      moment_id: momentId,
      expected_revision: 3,
      trashed: false,
    });
  });
});
