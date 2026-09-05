import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhoneNotificationsAnnouncement } from "./phone-notifications-announcement";

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
  Reflect.deleteProperty(window, "Notification");
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "PushManager");
});

function stubGrantedPermission() {
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission: "granted" },
  });
}

function stubExistingSubscription() {
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: {},
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue({
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue({
            endpoint: "https://push.example.test/device",
          }),
        },
      }),
    },
  });
}

describe("PhoneNotificationsAnnouncement", () => {
  it("offers Account once, then stays dismissed", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    const user = userEvent.setup();
    const { rerender } = render(<PhoneNotificationsAnnouncement />);

    expect(
      await screen.findByText(
        "Phone notifications are live — turn them on in Account.",
      ),
    ).toBeVisible();
    const account = screen.getByRole("link", { name: "Open Account" });
    expect(account).toHaveAttribute("href", "/settings/family#notifications");

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(
      screen.queryByText(
        "Phone notifications are live — turn them on in Account.",
      ),
    ).toBeNull();
    expect(
      window.localStorage.getItem("our-days:phone-notifications-announcement"),
    ).toBe("dismissed");

    rerender(<PhoneNotificationsAnnouncement />);
    await waitFor(() => {
      expect(
        screen.queryByText(
          "Phone notifications are live — turn them on in Account.",
        ),
      ).toBeNull();
    });
  });

  it("dismisses after opening Account", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    const user = userEvent.setup();
    render(<PhoneNotificationsAnnouncement />);

    await user.click(await screen.findByRole("link", { name: "Open Account" }));
    expect(
      screen.queryByText(
        "Phone notifications are live — turn them on in Account.",
      ),
    ).toBeNull();
    expect(
      window.localStorage.getItem("our-days:phone-notifications-announcement"),
    ).toBe("dismissed");
  });

  it("hides when OS permission is already granted", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    stubGrantedPermission();

    render(<PhoneNotificationsAnnouncement />);
    await waitFor(() => {
      expect(
        screen.queryByText(
          "Phone notifications are live — turn them on in Account.",
        ),
      ).toBeNull();
    });
  });

  it("hides when a push subscription is already on", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    stubExistingSubscription();

    render(<PhoneNotificationsAnnouncement />);
    await waitFor(() => {
      expect(
        screen.queryByText(
          "Phone notifications are live — turn them on in Account.",
        ),
      ).toBeNull();
    });
  });

  it("stays hidden when VAPID is missing", async () => {
    render(<PhoneNotificationsAnnouncement />);
    await waitFor(() => {
      expect(
        screen.queryByText(
          "Phone notifications are live — turn them on in Account.",
        ),
      ).toBeNull();
    });
  });
});
