// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const sendWebPush = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/web-push/send", () => ({
  sendWebPush,
}));

import type { FamilyActivityClient } from "./family-activity";
import {
  notifyFamilyActivity,
  resetFamilyActivityNotificationsForTests,
} from "./family-activity";

function deliveryRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    endpoint: "https://push.example.test/heidi",
    p256dh: "p256",
    auth: "auth",
    actor_name: "Molly",
    moment_id: "moment-1",
    moment_kind: "photo",
    reaction_type: null,
    visible_circle_id: "circle-home-gparents",
    circle_name: "Home + GParents",
    ...overrides,
  };
}

describe("notifyFamilyActivity", () => {
  afterEach(() => {
    resetFamilyActivityNotificationsForTests();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does nothing when VAPID keys are unset", async () => {
    const skipped = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const rpc = vi.fn();
    await notifyFamilyActivity(
      { rpc } as unknown as FamilyActivityClient,
      "moment",
      "moment-1",
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(sendWebPush).not.toHaveBeenCalled();
    expect(skipped).toHaveBeenCalledWith("[notifications] skipped", {
      reason: "not_configured",
      kind: "moment",
      activityId: "moment-1",
    });
  });

  it("logs an empty recipient list instead of sending", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    const empty = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({ data: [], error: null }));

    const result = await notifyFamilyActivity(
      { rpc } as unknown as FamilyActivityClient,
      "moment",
      "moment-1",
    );

    expect(result).toEqual({ status: "empty" });
    expect(sendWebPush).not.toHaveBeenCalled();
    expect(empty).toHaveBeenCalledWith("[notifications] empty", {
      kind: "moment",
      activityId: "moment-1",
      note: "unexpected unless every other member is the actor or nobody subscribed",
    });
  });

  it("does not notify when the RPC excludes the actor", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({ data: [], error: null }));

    await notifyFamilyActivity(
      { rpc } as unknown as FamilyActivityClient,
      "moment",
      "moment-actor",
    );

    expect(sendWebPush).not.toHaveBeenCalled();
  });

  it("logs RPC failures without throwing", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    const failed = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "unavailable" },
    }));

    await expect(
      notifyFamilyActivity(
        { rpc } as unknown as FamilyActivityClient,
        "note",
        "note-1",
      ),
    ).resolves.toEqual({ status: "error", message: "unavailable" });
    expect(sendWebPush).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith("[notifications] error", {
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
      data: [deliveryRow()],
      error: null,
    }));
    sendWebPush.mockRejectedValue(new Error("push gateway timeout"));

    await expect(
      notifyFamilyActivity(
        { rpc } as unknown as FamilyActivityClient,
        "moment",
        "moment-1",
      ),
    ).resolves.toEqual({
      status: "error",
      message: "push gateway timeout",
    });
    expect(failed).toHaveBeenCalledWith("[notifications] error", {
      kind: "moment",
      activityId: "moment-1",
      message: "push gateway timeout",
    });
  });

  it("sends who + what + circle and drops stale endpoints", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    const rpc = vi.fn(async (name: string) => {
      if (name === "list_web_push_deliveries") {
        return {
          data: [deliveryRow()],
          error: null,
        };
      }
      return { data: true, error: null };
    });
    sendWebPush.mockResolvedValue({ ok: false, status: 410, stale: true });
    const logged = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    await notifyFamilyActivity(
      { rpc } as unknown as FamilyActivityClient,
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
        title: "Molly posted a photo in Home + GParents.",
        url: "/family?circle=circle-home-gparents#moment-moment-1",
        tag: "our-days:moment:moment-1",
      },
    );
    expect(rpc).toHaveBeenCalledWith("delete_web_push_subscription", {
      endpoint: "https://push.example.test/heidi",
    });
    expect(logged).toHaveBeenCalledWith("[notifications] send", {
      kind: "moment",
      activityId: "moment-1",
      momentId: "moment-1",
      ok: false,
      status: 410,
      stale: true,
    });
    expect(logged).toHaveBeenCalledWith("[notifications] delivered", {
      kind: "moment",
      activityId: "moment-1",
      count: 1,
    });
  });

  it("sends one push per activity even when called twice", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    const skipped = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({
      data: [
        deliveryRow({
          endpoint: "https://push.example.test/dual",
          moment_id: "moment-3",
          moment_kind: "thought",
          circle_name: "Cedar Circle",
        }),
        deliveryRow({
          endpoint: "https://push.example.test/dual",
          moment_id: "moment-3",
          moment_kind: "thought",
          circle_name: "Cedar Circle",
        }),
      ],
      error: null,
    }));
    sendWebPush.mockResolvedValue({ ok: true, status: 201 });
    const client = { rpc } as unknown as FamilyActivityClient;

    await notifyFamilyActivity(client, "moment", "moment-3");
    await notifyFamilyActivity(client, "moment", "moment-3");

    expect(sendWebPush).toHaveBeenCalledTimes(1);
    expect(skipped).toHaveBeenCalledWith("[notifications] skipped", {
      reason: "already_notified",
      kind: "moment",
      activityId: "moment-3",
    });
  });

  it("uses comment copy with the circle even when the parent moment kind is present", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "Bpublic");
    vi.stubEnv("OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY", "privatekeyvalue");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({
      data: [
        deliveryRow({
          endpoint: "https://push.example.test/calvin",
          actor_name: "Heidi",
          moment_id: "moment-2",
          circle_name: "Harbor Circle",
        }),
      ],
      error: null,
    }));
    sendWebPush.mockResolvedValue({ ok: true, status: 201 });

    await notifyFamilyActivity(
      { rpc } as unknown as FamilyActivityClient,
      "note",
      "moment-2",
    );

    expect(sendWebPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: "Heidi commented on your entry in Harbor Circle.",
        url: "/family?circle=circle-home-gparents#moment-moment-2",
      }),
    );
  });
});
