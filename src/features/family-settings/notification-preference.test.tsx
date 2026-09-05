import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();
const remove = vi.fn();

vi.mock("./web-push-actions", () => ({
  saveWebPushSubscriptionAction: (...args: unknown[]) => save(...args),
  deleteWebPushSubscriptionAction: (...args: unknown[]) => remove(...args),
}));

import { NotificationPreference } from "./notification-preference";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "Notification");
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "PushManager");
});

describe("NotificationPreference", () => {
  it("enables and later mutes notifications on this device", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: "https://push.example.test/device",
      toJSON: () => ({
        endpoint: "https://push.example.test/device",
        keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
      }),
      unsubscribe,
    });
    const getSubscription = vi.fn().mockResolvedValue(null);
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: vi.fn().mockResolvedValue("granted"),
      },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: vi.fn().mockResolvedValue({
          pushManager: { subscribe, getSubscription },
        }),
        ready: Promise.resolve({
          pushManager: { subscribe, getSubscription },
        }),
      },
    });
    save.mockResolvedValue({ ok: true, message: "Notifications are on." });
    remove.mockResolvedValue({ ok: true, message: "Notifications are off." });

    const user = userEvent.setup();
    render(<NotificationPreference />);

    const enable = await screen.findByRole("button", {
      name: /Enable notifications/u,
    });
    await user.click(enable);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith({
      endpoint: "https://push.example.test/device",
      p256dh: "A".repeat(87),
      auth: "B".repeat(22),
    });

    getSubscription.mockResolvedValue({
      endpoint: "https://push.example.test/device",
      unsubscribe,
    });
    const disable = await screen.findByRole("button", {
      name: /Turn off notifications/u,
    });
    await user.click(disable);
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(screen.getByText(/Home Screen/u)).toBeVisible();
  });

  it("does not keep asking after the OS denies permission", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "denied",
        requestPermission: vi.fn(),
      },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: vi.fn().mockResolvedValue(null) },
        }),
      },
    });

    render(<NotificationPreference />);
    const blocked = await screen.findByRole("button", {
      name: /Notifications blocked/u,
    });
    expect(blocked).toBeDisabled();
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  });
});
