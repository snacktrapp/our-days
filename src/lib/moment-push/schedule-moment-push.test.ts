// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliverExpo: vi.fn(),
  deliverWeb: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/expo-push/deliver-activity", () => ({
  deliverActivityExpoPush: mocks.deliverExpo,
}));
vi.mock("@/lib/web-push/deliver-activity", () => ({
  deliverActivityWebPush: mocks.deliverWeb,
}));

import { MOMENT_PUSH_FALLBACK_MS, MOMENT_PUSH_POLL_MS } from "./constants";
import { scheduleMomentPush } from "./schedule-moment-push";

const momentId = "60000000-0000-4000-8000-000000000001";

function statusRow(
  input: Partial<{
    already_notified: boolean;
    media_ready: boolean;
    fallback_elapsed: boolean;
    should_send: boolean;
  }> = {},
) {
  return {
    already_notified: false,
    media_ready: false,
    fallback_elapsed: false,
    should_send: false,
    ...input,
  };
}

function client(
  statusSequence: ReturnType<typeof statusRow>[],
  claimResults: Array<boolean | "error"> = [true],
) {
  let statusIndex = 0;
  let claimIndex = 0;
  return {
    rpc: vi.fn(async (fn: string) => {
      if (fn === "moment_push_delivery_status") {
        const row =
          statusSequence[Math.min(statusIndex, statusSequence.length - 1)];
        statusIndex += 1;
        return { data: [row], error: null };
      }
      if (fn === "claim_moment_push_delivery") {
        const claimed =
          claimResults[Math.min(claimIndex, claimResults.length - 1)];
        claimIndex += 1;
        if (claimed === "error") {
          return { data: null, error: { message: "db" } };
        }
        return { data: claimed, error: null };
      }
      return { data: null, error: null };
    }),
  };
}

describe("scheduleMomentPush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.deliverExpo.mockResolvedValue(undefined);
    mocks.deliverWeb.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("sends once when media becomes ready before the fallback window", async () => {
    const supabase = client([
      statusRow(),
      statusRow({ media_ready: true, should_send: true }),
    ]);

    const pending = scheduleMomentPush(supabase, momentId);
    await vi.advanceTimersByTimeAsync(MOMENT_PUSH_POLL_MS);
    await pending;

    expect(mocks.deliverExpo).toHaveBeenCalledWith(
      supabase,
      "moment",
      momentId,
    );
    expect(mocks.deliverWeb).toHaveBeenCalledWith(supabase, "moment", momentId);
    expect(mocks.deliverExpo).toHaveBeenCalledWith(
      supabase,
      "mention",
      momentId,
    );
    expect(mocks.deliverWeb).toHaveBeenCalledWith(
      supabase,
      "mention",
      momentId,
    );
    expect(mocks.deliverExpo).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenCalledWith("claim_moment_push_delivery", {
      requested_moment_id: momentId,
    });
  });

  it("sends on fallback when media never becomes ready", async () => {
    const supabase = client([
      statusRow(),
      statusRow({ fallback_elapsed: true, should_send: true }),
    ]);

    const pending = scheduleMomentPush(supabase, momentId);
    await vi.advanceTimersByTimeAsync(MOMENT_PUSH_POLL_MS);
    await pending;

    expect(mocks.deliverExpo).toHaveBeenCalledWith(
      supabase,
      "moment",
      momentId,
    );
    expect(mocks.deliverExpo).toHaveBeenCalledTimes(2);
  });

  it("keeps polling when a ready claim loses to a newer upload, then sends once", async () => {
    const supabase = client(
      [
        statusRow({ media_ready: true, should_send: true }),
        statusRow(),
        statusRow({ media_ready: true, should_send: true }),
      ],
      [false, true],
    );

    const pending = scheduleMomentPush(supabase, momentId);
    await vi.advanceTimersByTimeAsync(MOMENT_PUSH_POLL_MS);
    await pending;

    expect(mocks.deliverExpo).toHaveBeenCalledTimes(2);
    expect(mocks.deliverWeb).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenCalledTimes(5);
  });

  it("does not send when a declined claim was already notified", async () => {
    const supabase = client(
      [
        statusRow({ media_ready: true, should_send: true }),
        statusRow({ already_notified: true, should_send: false }),
      ],
      [false],
    );

    await scheduleMomentPush(supabase, momentId);

    expect(mocks.deliverExpo).not.toHaveBeenCalled();
    expect(mocks.deliverWeb).not.toHaveBeenCalled();
  });

  it("exits at the deadline without sending while media is still unfinished", async () => {
    const supabase = client([statusRow()]);

    const pending = scheduleMomentPush(supabase, momentId);
    await vi.advanceTimersByTimeAsync(
      MOMENT_PUSH_FALLBACK_MS + MOMENT_PUSH_POLL_MS,
    );
    await pending;

    expect(mocks.deliverExpo).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "claim_moment_push_delivery",
      expect.anything(),
    );
  });

  it("stops after repeated claim RPC failures", async () => {
    const supabase = client(
      [statusRow({ media_ready: true, should_send: true })],
      ["error"],
    );

    const pending = scheduleMomentPush(supabase, momentId);
    await vi.advanceTimersByTimeAsync(MOMENT_PUSH_POLL_MS * 5);
    await pending;

    const claimCalls = supabase.rpc.mock.calls.filter(
      (call) => call[0] === "claim_moment_push_delivery",
    );
    expect(claimCalls).toHaveLength(3);
    expect(mocks.deliverExpo).not.toHaveBeenCalled();
  });

  it("stops immediately when the moment was already notified", async () => {
    const supabase = client([
      statusRow({ already_notified: true, should_send: false }),
    ]);

    await scheduleMomentPush(supabase, momentId);

    expect(mocks.deliverExpo).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "claim_moment_push_delivery",
      expect.anything(),
    );
  });

  it("polls while waiting for remaining media", async () => {
    const supabase = client([
      statusRow(),
      statusRow(),
      statusRow({ media_ready: true, should_send: true }),
    ]);

    const pending = scheduleMomentPush(supabase, momentId);
    await vi.advanceTimersByTimeAsync(MOMENT_PUSH_POLL_MS);
    await vi.advanceTimersByTimeAsync(MOMENT_PUSH_POLL_MS);
    await pending;

    expect(supabase.rpc).toHaveBeenCalledWith(
      "moment_push_delivery_status",
      expect.anything(),
    );
    expect(mocks.deliverExpo).toHaveBeenCalledTimes(2);
  });
});
