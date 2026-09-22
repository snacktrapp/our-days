// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  access: vi.fn(),
  memberships: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../../../config/our-days-environment", () => ({
  resolvedSiteOrigin: () => "https://journal.example.com",
  localJournalIsEnabled: () => false,
}));
vi.mock("@/lib/auth/journal-access", () => ({
  requireJournalAccess: mocks.access,
  readJournalCircleMemberships: mocks.memberships,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: async () => ({ rpc: mocks.rpc }),
}));
import { archiveCircleAction } from "./archive-circle-action";
const id = "20000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(
    new Headers({ origin: "https://journal.example.com" }),
  );
  mocks.access.mockResolvedValue({ mode: "authenticated", circleId: id });
  mocks.memberships.mockResolvedValue([{ circleId: id, role: "organizer" }]);
  mocks.rpc.mockResolvedValue({ error: null });
});
it.each([true, false])(
  "sets archive state %s and refreshes posting choices",
  async (archive) => {
    expect((await archiveCircleAction(id, archive)).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("set_circle_archived", {
      target_circle_id: id,
      archive,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  },
);
it("refuses non-organizers", async () => {
  mocks.memberships.mockResolvedValue([{ circleId: id, role: "member" }]);
  expect((await archiveCircleAction(id, true)).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not claim success after a database failure", async () => {
  mocks.rpc.mockResolvedValue({ error: { code: "42501" } });
  expect((await archiveCircleAction(id, true)).ok).toBe(false);
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("refuses cross-origin requests before reading identity", async () => {
  mocks.headers.mockResolvedValue(
    new Headers({ origin: "https://other.example.com" }),
  );
  expect((await archiveCircleAction(id, true)).ok).toBe(false);
  expect(mocks.access).not.toHaveBeenCalled();
});
it("does not pretend to archive preview data", async () => {
  mocks.access.mockResolvedValue({ mode: "preview" });
  expect((await archiveCircleAction(id, true)).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
