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

const originalUserAgent = navigator.userAgent;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "Notification");
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "PushManager");
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: originalUserAgent,
  });
});

function stubPushEnvironment(options?: {
  permission?: NotificationPermission;
  subscription?: {
    endpoint: string;
    unsubscribe: ReturnType<typeof vi.fn>;
  } | null;
}) {
  const unsubscribe = options?.subscription?.unsubscribe ?? vi.fn();
  const subscribe = vi.fn().mockResolvedValue({
    endpoint: "https://push.example.test/device",
    toJSON: () => ({
      endpoint: "https://push.example.test/device",
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    }),
    unsubscribe,
  });
  const getSubscription = vi
    .fn()
    .mockResolvedValue(options?.subscription ?? null);
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: {
      permission: options?.permission ?? "default",
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
  return { getSubscription, subscribe, unsubscribe };
}

describe("NotificationPreference", () => {
  it("toggles notifications on this device on and off", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    const { getSubscription, unsubscribe } = stubPushEnvironment();
    save.mockResolvedValue({ ok: true, message: "Notifications are on." });
    remove.mockResolvedValue({ ok: true, message: "Notifications are off." });

    const user = userEvent.setup();
    render(<NotificationPreference />);

    const toggle = await screen.findByRole("switch", { name: "Notifications" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(/Home Screen/u)).toBeNull();
    expect(screen.queryByText(/not available yet/iu)).toBeNull();

    await user.click(toggle);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith({
      endpoint: "https://push.example.test/device",
      p256dh: "A".repeat(87),
      auth: "B".repeat(22),
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    getSubscription.mockResolvedValue({
      endpoint: "https://push.example.test/device",
      unsubscribe,
    });
    await user.click(toggle);
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("does not keep asking after the OS denies permission", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    stubPushEnvironment({ permission: "denied" });

    render(<NotificationPreference />);
    const toggle = await screen.findByRole("switch", { name: "Notifications" });
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  });

  it("disables the switch when VAPID is missing", async () => {
    render(<NotificationPreference />);
    const toggle = await screen.findByRole("switch", { name: "Notifications" });
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Not available yet.")).toBeVisible();
    expect(screen.queryByText(/Home Screen/u)).toBeNull();
  });

  it("keeps the Home Screen note under the row on iPhone", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    stubPushEnvironment();
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });

    render(<NotificationPreference />);
    expect(
      await screen.findByText(
        "On iPhone and iPad, add Our Days to your Home Screen first.",
      ),
    ).toBeVisible();
  });
});
