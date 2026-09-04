import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrimaryNavigation } from "./primary-navigation";

const navigation = vi.hoisted(() => ({ pathname: "/family" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

describe("PrimaryNavigation", () => {
  beforeEach(() => {
    navigation.pathname = "/family";
  });

  afterEach(() => {
    document.querySelector("style#our-days-dynamic-css")?.remove();
  });

  it("contains destinations only", () => {
    render(<PrimaryNavigation section="timeline" />);

    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(navigation).toHaveTextContent("Family");
    expect(navigation).toHaveTextContent("People");
    expect(navigation).toHaveTextContent("Memories");
    expect(navigation).toHaveTextContent("Account");
    expect(navigation).not.toHaveTextContent("Add");
    expect(screen.queryByRole("button", { name: "Add moment" })).toBeNull();
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
    expect(screen.getByRole("link", { name: "Family" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("selects a destination immediately while navigation is pending", async () => {
    const user = userEvent.setup();
    render(<PrimaryNavigation section="timeline" />);

    const people = screen.getByRole("link", { name: "People" });
    await user.click(people);

    expect(people).toHaveClass("active");
    expect(people).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Family" })).not.toHaveClass(
      "active",
    );
    expect(people.querySelector(".nav-symbol-pending")).not.toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Family" })
        .querySelector(".nav-symbol-pending"),
    ).toBeNull();
  });

  it("moves the current tab when a family-dropdown journal is chosen", () => {
    render(<PrimaryNavigation section="timeline" />);
    expect(screen.getByRole("link", { name: "Family" })).toHaveClass("active");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("our-days:navigate-section", {
          detail: { href: "/people/molly" },
        }),
      );
    });

    expect(screen.getByRole("link", { name: "People" })).toHaveClass("active");
    expect(screen.getByRole("link", { name: "Family" })).not.toHaveClass(
      "active",
    );
  });

  it("does not pulse the current tab when it is tapped again", async () => {
    const user = userEvent.setup();
    render(<PrimaryNavigation section="timeline" />);
    await user.click(screen.getByRole("link", { name: "Family" }));
    expect(
      screen
        .getByRole("link", { name: "Family" })
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

    await user.click(screen.getByRole("link", { name: "People" }));

    expect(document.documentElement.getAttribute("style")).toBeNull();
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
