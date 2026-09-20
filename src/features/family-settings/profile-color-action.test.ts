// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  access: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
  local: vi.fn(),
  saveLocal: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/lib/auth/journal-access", () => ({
  requireJournalAccess: mocks.access,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/local-journal/store", () => ({
  saveLocalProfileColor: mocks.saveLocal,
}));
vi.mock("../../../config/our-days-environment", () => ({
  resolvedSiteOrigin: () => "https://journal.example.com",
  localJournalIsEnabled: mocks.local,
}));
import { saveProfileColorAction } from "./profile-color-action";

describe("save profile color", () => {
  beforeEach(() => {
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "https://journal.example.com" }),
    );
    mocks.access.mockResolvedValue({ mode: "authenticated", personId: "me" });
    mocks.local.mockReturnValue(false);
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });
  afterEach(() => vi.clearAllMocks());
  it("uses a caller-owned RPC with no supplied person ID and refreshes all routes", async () => {
    expect((await saveProfileColorAction("violet")).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("set_my_profile_color", {
      color: "violet",
    });
    expect(mocks.refresh).toHaveBeenCalledWith("/", "layout");
  });
  it("rejects unknown colors and foreign origins before mutation", async () => {
    expect((await saveProfileColorAction("neon")).ok).toBe(false);
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "https://other.example.com" }),
    );
    expect((await saveProfileColorAction("violet")).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not report success for a failed or empty update", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await saveProfileColorAction("violet")).ok).toBe(false);
    mocks.rpc.mockRejectedValue(new Error("offline"));
    expect((await saveProfileColorAction("violet")).ok).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("keeps design previews detached and supports the local journal", async () => {
    mocks.access.mockResolvedValue({ mode: "preview" });
    expect((await saveProfileColorAction("violet")).message).toContain(
      "Preview",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue({ mode: "authenticated", personId: "me" });
    mocks.local.mockReturnValue(true);
    expect((await saveProfileColorAction("violet")).ok).toBe(true);
    expect(mocks.saveLocal).toHaveBeenCalledWith(
      { mode: "authenticated", personId: "me" },
      "violet",
    );
  });
});
