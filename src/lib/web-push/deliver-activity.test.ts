// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const sendWebPush = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("./send", () => ({
  sendWebPush,
}));

import type { ActivityPushClient } from "./deliver-activity";
import { deliverActivityWebPush } from "./deliver-activity";

describe("deliverActivityWebPush", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does nothing when VAPID keys are unset", async () => {
    const skipped = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const rpc = vi.fn();
    await deliverActivityWebPush(
      { rpc } as unknown as ActivityPushClient,
      "moment",
      "moment-1",
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(sendWebPush).not.toHaveBeenCalled();
    expect(skipped).toHaveBeenCalledWith("[web-push] skipped", {
      reason: "not_configured",
      kind: "moment",
      activityId: "moment-1",
    });
  });

  it("logs an empty recipient list instead of sending", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    const skipped = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({ data: [], error: null }));

    await deliverActivityWebPush(
      { rpc } as unknown as ActivityPushClient,
      "moment",
      "moment-1",
    );

    expect(sendWebPush).not.toHaveBeenCalled();
    expect(skipped).toHaveBeenCalledWith("[web-push] skipped", {
      reason: "empty_recipients",
      kind: "moment",
      activityId: "moment-1",
    });
  });

  it("logs RPC failures without throwing", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    const warned = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "unavailable" },
    }));

    await expect(
      deliverActivityWebPush(
        { rpc } as unknown as ActivityPushClient,
        "note",
        "note-1",
      ),
    ).resolves.toBeUndefined();
    expect(sendWebPush).not.toHaveBeenCalled();
    expect(warned).toHaveBeenCalledWith("[web-push] skipped", {
      reason: "rpc_error",
      kind: "note",
      activityId: "note-1",
      message: "unavailable",
    });
  });

  it("logs unexpected send failures without throwing", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    const failed = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({
      data: [
        {
          endpoint: "https://push.example.test/heidi",
          p256dh: "p256",
          auth: "auth",
          actor_name: "Molly",
          moment_id: "moment-1",
          moment_kind: "photo",
          reaction_type: null,
          visible_circle_id: "circle-1",
        },
      ],
      error: null,
    }));
    sendWebPush.mockRejectedValue(new Error("push gateway timeout"));

    await expect(
      deliverActivityWebPush(
        { rpc } as unknown as ActivityPushClient,
        "moment",
        "moment-1",
      ),
    ).resolves.toBeUndefined();
    expect(failed).toHaveBeenCalledWith("[web-push] failed", {
      kind: "moment",
      activityId: "moment-1",
      message: "push gateway timeout",
    });
  });

  it("sends quiet titles and drops stale endpoints", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    const rpc = vi.fn(async (name: string) => {
      if (name === "list_web_push_deliveries") {
        return {
          data: [
            {
              endpoint: "https://push.example.test/heidi",
              p256dh: "p256",
              auth: "auth",
              actor_name: "Molly",
              moment_id: "moment-1",
              moment_kind: "photo",
              reaction_type: null,
              visible_circle_id: "circle-home-gparents",
            },
          ],
          error: null,
        };
      }
      return { data: true, error: null };
    });
    sendWebPush.mockResolvedValue({ ok: false, status: 410, stale: true });
    const logged = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    await deliverActivityWebPush(
      { rpc } as unknown as ActivityPushClient,
      "moment",
      "moment-1",
    );

    expect(sendWebPush).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example.test/heidi",
        p256dh: "p256",
        auth: "auth",
      },
      {
        title: "Molly posted a photo.",
        url: "/family?circle=circle-home-gparents#moment-moment-1",
        tag: "our-days:moment:moment-1",
      },
    );
    expect(rpc).toHaveBeenCalledWith("delete_web_push_subscription", {
      endpoint: "https://push.example.test/heidi",
    });
    expect(logged).toHaveBeenCalledWith("[web-push] send", {
      kind: "moment",
      activityId: "moment-1",
      momentId: "moment-1",
      ok: false,
      status: 410,
      stale: true,
    });
    expect(logged).toHaveBeenCalledWith("[web-push] stale_endpoint_deleted", {
      kind: "moment",
      activityId: "moment-1",
      momentId: "moment-1",
      deleted: true,
    });
  });

  it("sends one push when the RPC returns the same endpoint twice", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    const logged = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({
      data: [
        {
          endpoint: "https://push.example.test/dual",
          p256dh: "p256",
          auth: "auth",
          actor_name: "Molly",
          moment_id: "moment-3",
          moment_kind: "thought",
          reaction_type: null,
        },
        {
          endpoint: "https://push.example.test/dual",
          p256dh: "p256",
          auth: "auth",
          actor_name: "Molly",
          moment_id: "moment-3",
          moment_kind: "thought",
          reaction_type: null,
        },
      ],
      error: null,
    }));
    sendWebPush.mockResolvedValue({ ok: true, status: 201 });

    await deliverActivityWebPush(
      { rpc } as unknown as ActivityPushClient,
      "moment",
      "moment-3",
    );

    expect(sendWebPush).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith("[web-push] recipients", {
      kind: "moment",
      activityId: "moment-3",
      count: 1,
    });
  });

  it("uses comment copy even when the parent moment kind is present", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    const rpc = vi.fn(async () => ({
      data: [
        {
          endpoint: "https://push.example.test/calvin",
          p256dh: "p256",
          auth: "auth",
          actor_name: "Heidi",
          moment_id: "moment-2",
          moment_kind: "photo",
          reaction_type: null,
        },
      ],
      error: null,
    }));
    sendWebPush.mockResolvedValue({ ok: true, status: 201 });

    await deliverActivityWebPush(
      { rpc } as unknown as ActivityPushClient,
      "note",
      "moment-2",
    );

    expect(sendWebPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: "Heidi commented on your entry.",
      }),
    );
  });
});
