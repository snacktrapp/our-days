// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  access: vi.fn(),
  memberships: vi.fn(),
  rpc: vi.fn(),
  cookie: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../../../config/our-days-environment", () => ({
  resolvedSiteOrigin: () => "https://journal.example.com",
  localJournalIsEnabled: () => false,
}));
vi.mock("@/lib/auth/active-circle", () => ({
  isActiveCircleToken: (id: string) => /^[a-z]+$/.test(id),
  writeActiveCircleCookie: mocks.cookie,
}));
vi.mock("@/lib/auth/journal-access", () => ({
  requireJournalAccess: mocks.access,
  readJournalCircleMemberships: mocks.memberships,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: async () => ({ rpc: mocks.rpc }),
}));
import { deleteCircleAction } from "./delete-circle-action";
describe("delete unused circle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "https://journal.example.com" }),
    );
    mocks.access.mockResolvedValue({
      mode: "authenticated",
      circleId: "empty",
    });
    mocks.memberships.mockResolvedValue([
      { circleId: "empty", role: "organizer" },
      { circleId: "home", role: "member" },
    ]);
    mocks.rpc.mockResolvedValue({ error: null });
  });
  it("switches away from the removed active circle after confirmed deletion", async () => {
    expect((await deleteCircleAction("empty", "Empty")).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("delete_empty_circle", {
      target_circle_id: "empty",
      expected_name: "Empty",
    });
    expect(mocks.cookie).toHaveBeenCalledWith("home");
  });
  it("does not change active circle when the database refuses deletion", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "23514" } });
    expect((await deleteCircleAction("empty", "Empty")).ok).toBe(false);
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests before accessing data", async () => {
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "https://other.example.com" }),
    );
    expect((await deleteCircleAction("empty", "Empty")).ok).toBe(false);
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("refuses the last circle", async () => {
    mocks.memberships.mockResolvedValue([
      { circleId: "empty", role: "organizer" },
    ]);
    expect((await deleteCircleAction("empty", "Empty")).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("never pretends to delete preview data", async () => {
    mocks.access.mockResolvedValue({ mode: "preview" });
    expect((await deleteCircleAction("empty", "Empty")).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
