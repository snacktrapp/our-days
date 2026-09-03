import { render, screen } from "@testing-library/react";
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
    document.getElementById("bottom-nav-visual-inset-sheet")?.remove();
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

    expect(
      document.getElementById("bottom-nav-visual-inset-sheet")?.textContent,
    ).toBe(":root{--bottom-nav-visual-inset:0px}");
  });
});
