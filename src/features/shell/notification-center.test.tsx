import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "./notification-center";

const items = [
  {
    id: "note-one",
    actorName: "Molly",
    message: "commented on your photo.",
    displayDate: "Today",
    href: "/family#moment-one",
  },
] as const;

describe("NotificationCenter", () => {
  beforeEach(() => window.localStorage.clear());

  it("opens activity and clears the unread indicator", async () => {
    const user = userEvent.setup();
    render(<NotificationCenter items={items} />);

    const trigger = screen.getByRole("button", {
      name: "Open notifications, 1 new",
    });
    await user.click(trigger);
    expect(screen.getByRole("region", { name: "Notifications" })).toHaveClass(
      "overlay-popover",
    );
    expect(
      screen.getByRole("region", { name: "Notifications" }),
    ).toHaveTextContent("Molly commented on your photo.");
    expect(trigger).toHaveAccessibleName("Open notifications");
    expect(
      window.localStorage.getItem("our-days:seen-notifications"),
    ).toContain("note-one");
  });

  it("dismisses the activity window with a reverse pop", async () => {
    const user = userEvent.setup();
    render(<NotificationCenter items={items} />);
    await user.click(
      screen.getByRole("button", { name: /Open notifications/u }),
    );
    await user.click(
      screen.getByRole("button", { name: "Close notifications" }),
    );
    const panel = document.querySelector(".notification-panel");
    expect(panel).toHaveClass("overlay-popover");
    expect(panel).toHaveClass("is-closing");
    expect(panel).toHaveAttribute("aria-hidden", "true");
  });

  it("dismisses the activity window instantly when motion is reduced", async () => {
    const media = vi.mocked(window.matchMedia);
    media.mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      const user = userEvent.setup();
      render(<NotificationCenter items={items} />);
      await user.click(
        screen.getByRole("button", { name: /Open notifications/u }),
      );
      await user.click(
        screen.getByRole("button", { name: "Close notifications" }),
      );
      expect(
        screen.queryByRole("region", { name: "Notifications" }),
      ).toBeNull();
      expect(document.querySelector(".notification-panel")).toBeNull();
    } finally {
      media.mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    }
  });
});
