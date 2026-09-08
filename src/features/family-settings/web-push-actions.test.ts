// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  deliver: vi.fn(),
  getHeaders: vi.fn(),
  requireAccess: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.getHeaders }));
vi.mock("@/lib/auth/journal-access", () => ({
  requireJournalAccess: mocks.requireAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));
vi.mock("@/lib/web-push/deliver-activity", () => ({
  deliverActivityWebPush: mocks.deliver,
}));

import {
  deleteWebPushSubscriptionAction,
  deliverPublishedMomentPushAction,
  saveWebPushSubscriptionAction,
} from "./web-push-actions";

const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
const p256dh = "A".repeat(87);
const auth = "B".repeat(22);

describe("web push subscription actions", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    mocks.getHeaders.mockResolvedValue(
      new Headers({ origin: "https://journal.example.com" }),
    );
    mocks.requireAccess.mockResolvedValue({
      mode: "authenticated",
      membershipId: "membership-a",
      circleId: "20000000-0000-4000-8000-000000000001",
      personId: "30000000-0000-4000-8000-000000000001",
      role: "member",
    });
    mocks.rpc.mockResolvedValue({ data: "sub-1", error: null });
    mocks.deliver.mockResolvedValue(undefined);
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("saves only reviewed subscription fields", async () => {
    await expect(
      saveWebPushSubscriptionAction({ endpoint, p256dh, auth }),
    ).resolves.toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("save_web_push_subscription", {
      endpoint,
      p256dh,
      auth,
    });
  });

  it("rejects an insecure endpoint before talking to the database", async () => {
    await expect(
      saveWebPushSubscriptionAction({
        endpoint: "http://push.example.test/insecure",
        p256dh,
        auth,
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("deletes the current device subscription", async () => {
    await expect(
      deleteWebPushSubscriptionAction({ endpoint }),
    ).resolves.toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("delete_web_push_subscription", {
      endpoint,
    });
  });

  it("awaits published moment push delivery", async () => {
    const momentId = "60000000-0000-4000-8000-000000000001";
    let resolveDelivery: (() => void) | undefined;
    const delivery = new Promise<void>((resolve) => {
      resolveDelivery = resolve;
    });
    mocks.deliver.mockReturnValue(delivery);

    const action = deliverPublishedMomentPushAction({ momentId });
    await vi.waitFor(() => {
      expect(mocks.deliver).toHaveBeenCalledWith(
        { rpc: mocks.rpc },
        "moment",
        momentId,
      );
    });
    expect(await Promise.race([action, Promise.resolve("pending")])).toBe(
      "pending",
    );
    resolveDelivery?.();
    await expect(action).resolves.toMatchObject({ ok: true });
  });
});
