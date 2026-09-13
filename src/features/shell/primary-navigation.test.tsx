import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrimaryNavigation } from "./primary-navigation";

const navigation = vi.hoisted(() => ({ pathname: "/family" }));
const composerSession = vi.hoisted(() => ({
  toggleCreate: vi.fn(),
  openCreate: vi.fn(),
  isOpen: false,
  openEdit: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock("@/features/composer/composer-session", () => ({
  useComposerSession: () => composerSession,
}));

describe("PrimaryNavigation", () => {
  beforeEach(() => {
    navigation.pathname = "/family";
    composerSession.isOpen = false;
    composerSession.toggleCreate.mockReset();
  });

  afterEach(() => {
    document.querySelector("style#our-days-dynamic-css")?.remove();
    document.documentElement.style.removeProperty("--vv-offset-top");
    document.documentElement.style.removeProperty("--vv-bottom-inset");
  });

  it("contains Journal, Add, and Account", () => {
    render(<PrimaryNavigation section="timeline" />);

    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(navigation).toHaveTextContent("Journal");
    expect(navigation).not.toHaveTextContent("Home");
    expect(navigation).not.toHaveTextContent("People");
    expect(navigation).not.toHaveTextContent("Memories");
    expect(navigation).toHaveTextContent("Add");
    expect(navigation).toHaveTextContent("Account");
    expect(screen.getByRole("button", { name: "Add" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add moment" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Memories" })).toBeNull();
  });

  it("opens Add from Family without forcing Just me", async () => {
    const user = userEvent.setup();
    navigation.pathname = "/family";
    render(<PrimaryNavigation section="timeline" />);

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(composerSession.toggleCreate).toHaveBeenCalledWith(
      expect.any(HTMLButtonElement),
      undefined,
    );
  });

  it("opens Add from a personal journal with Just me", async () => {
    const user = userEvent.setup();
    navigation.pathname = "/people/person-1";
    render(<PrimaryNavigation section="timeline" />);

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(composerSession.toggleCreate).toHaveBeenCalledWith(
      expect.any(HTMLButtonElement),
      { defaultAudience: "just_me" },
    );
  });

  it("marks Account current in family settings", () => {
    navigation.pathname = "/settings/family";
    render(<PrimaryNavigation section="settings" />);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps the tab bar from crashing while the route pathname is still warming", () => {
    navigation.pathname = null as unknown as string;
    render(<PrimaryNavigation section="timeline" />);
    expect(screen.getByRole("link", { name: "Journal" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("selects a destination immediately while navigation is pending", async () => {
    const user = userEvent.setup();
    render(<PrimaryNavigation section="timeline" />);

    const account = screen.getByRole("link", { name: "Account" });
    await user.click(account);

    expect(account).toHaveClass("active");
    expect(account).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Journal" })).not.toHaveClass(
      "active",
    );
    expect(account.querySelector(".nav-symbol-pending")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Journal" })
        .querySelector(".nav-symbol-pending"),
    ).toBeNull();
  });

  it("moves the current tab when a family-dropdown journal is chosen", () => {
    render(<PrimaryNavigation section="timeline" />);
    expect(screen.getByRole("link", { name: "Journal" })).toHaveClass("active");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("our-days:navigate-section", {
          detail: { href: "/people/molly" },
        }),
      );
    });

    expect(screen.getByRole("link", { name: "Journal" })).toHaveClass("active");
    expect(screen.getByRole("link", { name: "Account" })).not.toHaveClass(
      "active",
    );
  });

  it("does not pulse the current tab when it is tapped again", async () => {
    const user = userEvent.setup();
    render(<PrimaryNavigation section="timeline" />);
    await user.click(screen.getByRole("link", { name: "Journal" }));
    expect(
      screen
        .getByRole("link", { name: "Journal" })
        .querySelector(".nav-symbol-pending"),
    ).toBeNull();
  });

  it("pins the tab bar to the visual viewport while a destination is opening", async () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 844,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        height: 760,
        offsetTop: 0,
        removeEventListener: vi.fn(),
      },
    });
    const user = userEvent.setup();
    render(<PrimaryNavigation section="timeline" />);

    await user.click(screen.getByRole("link", { name: "Account" }));

    expect(
      document.documentElement.style.getPropertyValue("--vv-offset-top"),
    ).toBe("0px");
    expect(
      document.documentElement.style.getPropertyValue("--vv-bottom-inset"),
    ).toBe("84px");
    expect(
      document.head.querySelector("style#our-days-dynamic-css"),
    ).toBeNull();
  });

  it("compacts the tab bar while scrolling down and restores it at the top", () => {
    let scrollY = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollY,
    });
    render(<PrimaryNavigation section="timeline" />);
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(nav).not.toHaveClass("is-compact");

    scrollY = 80;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(nav).toHaveClass("is-compact");

    scrollY = 8;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(nav).not.toHaveClass("is-compact");
  });

  it("restores the tab bar after scrolling goes idle", () => {
    vi.useFakeTimers();
    let scrollY = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollY,
    });
    render(<PrimaryNavigation section="timeline" />);
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    scrollY = 64;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(nav).toHaveClass("is-compact");
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(nav).not.toHaveClass("is-compact");
    vi.useRealTimers();
  });
});
