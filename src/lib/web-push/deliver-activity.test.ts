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
  });

  it("does nothing when VAPID keys are unset", async () => {
    const rpc = vi.fn();
    await deliverActivityWebPush(
      { rpc } as unknown as ActivityPushClient,
      "moment",
      "moment-1",
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(sendWebPush).not.toHaveBeenCalled();
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
            },
          ],
          error: null,
        };
      }
      return { data: true, error: null };
    });
    sendWebPush.mockResolvedValue({ ok: false, status: 410, stale: true });

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
        url: "/family#moment-moment-1",
        tag: "our-days:moment:moment-1",
      },
    );
    expect(rpc).toHaveBeenCalledWith("delete_web_push_subscription", {
      endpoint: "https://push.example.test/heidi",
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
