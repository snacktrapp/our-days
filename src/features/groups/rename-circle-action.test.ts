// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHeaders: vi.fn(),
  revalidatePath: vi.fn(),
  requireAccess: vi.fn(),
  readMemberships: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  renameLocalCircle: vi.fn(),
  localJournalIsEnabled: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.getHeaders }));
vi.mock("@/lib/auth/journal-access", () => ({
  requireJournalAccess: mocks.requireAccess,
  readJournalCircleMemberships: mocks.readMemberships,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));
vi.mock("@/lib/local-journal/store", () => ({
  renameLocalCircle: mocks.renameLocalCircle,
}));
vi.mock("../../../config/our-days-environment", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../config/our-days-environment")
    >();
  return {
    ...actual,
    localJournalIsEnabled: mocks.localJournalIsEnabled,
  };
});

import { renameCircleAction } from "./rename-circle-action";

const circleId = "20000000-0000-4000-8000-000000000001";
const membershipId = "40000000-0000-4000-8000-000000000001";

describe("rename circle action", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    mocks.getHeaders.mockResolvedValue(
      new Headers({ origin: "https://journal.example.com" }),
    );
    mocks.localJournalIsEnabled.mockReturnValue(false);
    mocks.requireAccess.mockResolvedValue({
      mode: "authenticated",
      membershipId,
      circleId,
      personId: "30000000-0000-4000-8000-000000000001",
      role: "organizer",
    });
    mocks.readMemberships.mockResolvedValue([
      {
        membershipId,
        circleId,
        personId: "30000000-0000-4000-8000-000000000001",
        role: "organizer",
      },
    ]);
    mocks.rpc.mockResolvedValue({ data: circleId, error: null });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.renameLocalCircle.mockResolvedValue({ circleId });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("renames through the starter-only RPC and refreshes Account surfaces", async () => {
    await expect(
      renameCircleAction({ name: "Trapp Family", circleId }),
    ).resolves.toEqual({
      ok: true,
      message: "Circle renamed.",
    });

    expect(mocks.rpc).toHaveBeenCalledWith("update_circle", {
      circle_id: circleId,
      circle_name: "Trapp Family",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/family");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/family");
  });

  it("renames a local-journal circle the actor started", async () => {
    mocks.localJournalIsEnabled.mockReturnValue(true);

    await expect(
      renameCircleAction({ name: "Cousins", circleId }),
    ).resolves.toEqual({
      ok: true,
      message: "Circle renamed.",
    });

    expect(mocks.renameLocalCircle).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "authenticated" }),
      circleId,
      "Cousins",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing name without calling the database", async () => {
    await expect(
      renameCircleAction({ name: "   ", circleId }),
    ).resolves.toEqual({
      ok: false,
      message: "A circle name is required.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a circle the actor does not organize", async () => {
    mocks.readMemberships.mockResolvedValue([
      {
        membershipId,
        circleId,
        personId: "30000000-0000-4000-8000-000000000001",
        role: "member",
      },
    ]);

    await expect(
      renameCircleAction({ name: "Stolen", circleId }),
    ).resolves.toEqual({
      ok: false,
      message: "That circle could not be renamed.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
