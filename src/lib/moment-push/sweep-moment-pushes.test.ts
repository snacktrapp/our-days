// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendWeb: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: vi.fn(),
}));
vi.mock("@/lib/web-push/keys", () => ({
  webPushIsConfigured: () => true,
}));
vi.mock("@/lib/web-push/send", () => ({
  sendWebPush: mocks.sendWeb,
}));

import { runMomentPushSweep } from "./sweep-moment-pushes";

const momentId = "60000000-0000-4000-8000-000000000003";
const secret = "sweep-secret-fixture";

function row(
  input: Partial<{
    channel: string;
    kind: string;
    destination: string | null;
  }> = {},
) {
  return {
    moment_id: momentId,
    channel: "web",
    kind: "moment",
    destination: "https://push.example.test/member",
    p256dh: "B".repeat(87),
    auth: "C".repeat(22),
    actor_name: "A Organizer Two",
    moment_kind: "photo",
    visible_circle_id: null,
    circle_name: null,
    snippet: null,
    note_id: null,
    ...input,
  };
}

function client(batches: unknown[][]) {
  let index = 0;
  return {
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      expect(fn).toBe("sweep_due_moment_pushes");
      expect(args?.presented_secret).toBe(secret);
      const data = batches[Math.min(index, batches.length - 1)] ?? [];
      index += 1;
      return { data, error: null };
    }),
  };
}

describe("runMomentPushSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = secret;
    mocks.sendWeb.mockResolvedValue({ ok: true, status: 201, stale: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })),
    );
  });

  it("sends each claimed delivery once and does not send a second empty sweep", async () => {
    const supabase = client([
      [
        row({ channel: "claimed", destination: null }),
        row(),
        row({
          channel: "expo",
          destination: "ExponentPushToken[sweep]",
        }),
      ],
      [],
    ]);

    const first = await runMomentPushSweep(supabase);
    const second = await runMomentPushSweep(supabase);

    expect(first).toEqual({ claimed: 1, deliveries: 2 });
    expect(second).toEqual({ claimed: 0, deliveries: 0 });
    expect(mocks.sendWeb).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not send the claim marker or a duplicate endpoint", async () => {
    const supabase = client([
      [row({ channel: "claimed", destination: null }), row(), row()],
    ]);

    await runMomentPushSweep(supabase);

    expect(mocks.sendWeb).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
