// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock("@/lib/moment-push/sweep-moment-pushes", () => ({
  runMomentPushSweep: mocks.run,
}));

import { GET } from "./route";

const secret = "sweep-secret-fixture";

function request(authorization?: string) {
  return new Request("https://journal.example/api/cron/moment-push", {
    headers: authorization ? { authorization } : {},
  });
}

describe("moment push cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = secret;
    mocks.run.mockResolvedValue({ claimed: 1, deliveries: 1 });
  });

  it("rejects a missing or wrong bearer secret", async () => {
    const missing = await GET(request());
    const wrong = await GET(request("Bearer not-the-secret"));
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(missing.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("sweeps when the bearer matches and does not echo database errors", async () => {
    const ok = await GET(request(`Bearer ${secret}`));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, claimed: 1, deliveries: 1 });
    expect(mocks.run).toHaveBeenCalledTimes(1);

    mocks.run.mockRejectedValueOnce(new Error("secret hash mismatch detail"));
    const failed = await GET(request(`Bearer ${secret}`));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("secret hash");
  });
});
