// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readAccess, loadActivity } = vi.hoisted(() => ({
  readAccess: vi.fn(),
  loadActivity: vi.fn(),
}));
vi.mock("@/lib/auth/journal-access", () => ({
  readJournalAccessState: readAccess,
}));
vi.mock("@/data/journal-context.server", () => ({
  loadJournalActivityNotifications: loadActivity,
}));
import { GET } from "./route";

describe("fresh Activity endpoint", () => {
  beforeEach(() => vi.resetAllMocks());
  it("requires authentication and never caches a response", async () => {
    readAccess.mockResolvedValue({ mode: "anonymous" });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(loadActivity).not.toHaveBeenCalled();
  });
  it("uses the server session rather than client-supplied circle or user ids", async () => {
    const access = {
      mode: "authenticated",
      membershipId: "viewer",
      circleId: "home",
    };
    readAccess.mockResolvedValue(access);
    loadActivity.mockResolvedValue([{ id: "note:new" }]);
    const response = await GET();
    expect(await response.json()).toEqual({
      items: [{ id: "note:new" }],
      observedAt: expect.any(String),
    });
    expect(loadActivity).toHaveBeenCalledWith(access, {}, { strict: true });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("reports a failed query, not a successful empty history", async () => {
    readAccess.mockResolvedValue({ mode: "authenticated" });
    loadActivity.mockRejectedValue(new Error("private database detail"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
  });
});
