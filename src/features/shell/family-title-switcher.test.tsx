import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FamilyTitleSwitcher } from "./family-title-switcher";
import type { JournalChromeViewModel } from "./shell-view-model";

const model = {
  accent: "teal",
  eyebrow: "Our family",
  title: "All our days",
} as JournalChromeViewModel;

const switcher = [
  { label: "Family", href: "/family", current: true },
  { label: "Molly", href: "/people/molly", current: false },
] as const;

describe("FamilyTitleSwitcher", () => {
  it("pops the family list and dismisses it with a reverse pop", () => {
    const { container } = render(
      <FamilyTitleSwitcher model={model} switcher={switcher} />,
    );
    const details = container.querySelector(".title-switcher");
    fireEvent.click(
      screen.getByRole("heading", { name: "All our days" }).closest("summary")!,
    );
    expect(details).toHaveAttribute("open");
    expect(
      screen.getByRole("navigation", { name: "Choose a family timeline" }),
    ).not.toHaveClass("overlay-popover");

    fireEvent.keyDown(window, { key: "Escape" });
    const nav = container.querySelector(".title-switcher nav");
    expect(nav).toHaveClass("is-closing");
    expect(nav).toHaveAttribute("aria-hidden", "true");
    expect(details).toHaveAttribute("open");
  });

  it("dismisses the family list instantly when motion is reduced", () => {
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
      const { container } = render(
        <FamilyTitleSwitcher model={model} switcher={switcher} />,
      );
      fireEvent.click(
        screen
          .getByRole("heading", { name: "All our days" })
          .closest("summary")!,
      );
      fireEvent.keyDown(window, { key: "Escape" });
      expect(container.querySelector(".title-switcher")).not.toHaveAttribute(
        "open",
      );
      expect(container.querySelector(".title-switcher nav")).not.toHaveClass(
        "is-closing",
      );
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

  it("pulses a family journal row as soon as it is pressed", () => {
    render(<FamilyTitleSwitcher model={model} switcher={switcher} />);
    fireEvent.click(
      screen.getByRole("heading", { name: "All our days" }).closest("summary")!,
    );
    const molly = screen.getByRole("link", { name: "Molly" });
    fireEvent.pointerDown(molly, { button: 0 });
    expect(molly).toHaveClass("is-pending");
    expect(molly.querySelector(".title-switcher-link-pending")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Family" })).not.toHaveClass(
      "is-pending",
    );
  });

  it("moves the current highlight to the pressed journal immediately", () => {
    render(<FamilyTitleSwitcher model={model} switcher={switcher} />);
    fireEvent.click(
      screen.getByRole("heading", { name: "All our days" }).closest("summary")!,
    );
    const family = screen.getByRole("link", { name: "Family" });
    const molly = screen.getByRole("link", { name: "Molly" });
    expect(family).toHaveClass("active");
    expect(family).toHaveAttribute("aria-current", "page");

    fireEvent.pointerDown(molly, { button: 0 });

    expect(molly).toHaveClass("active");
    expect(molly).toHaveAttribute("aria-current", "page");
    expect(family).not.toHaveClass("active");
    expect(family).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { name: "Molly" })).toBeVisible();
  });
});
