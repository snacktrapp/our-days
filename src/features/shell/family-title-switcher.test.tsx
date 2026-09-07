import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FamilyTitleSwitcher } from "./family-title-switcher";
import type { JournalChromeViewModel } from "./shell-view-model";

const model = {
  accent: "teal",
  eyebrow: "Group",
  title: "All our days",
} as JournalChromeViewModel;

const switcher = [
  { kind: "you", label: "Brian", href: "/people/brian", current: false },
  { kind: "group", label: "All our days", href: "/family", current: true },
  { kind: "person", label: "Molly", href: "/people/molly", current: false },
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

  it("selects a family journal row as soon as it is pressed", () => {
    render(<FamilyTitleSwitcher model={model} switcher={switcher} />);
    fireEvent.click(
      screen.getByRole("heading", { name: "All our days" }).closest("summary")!,
    );
    const molly = screen.getByRole("link", { name: "Molly" });
    fireEvent.pointerDown(molly, { button: 0 });
    expect(molly).toHaveClass("active");
    expect(molly.querySelector(".title-switcher-link-pending")).toBeNull();
    expect(screen.getByRole("link", { name: "All our days" })).not.toHaveClass(
      "active",
    );
  });

  it("moves the current highlight to the pressed journal immediately", () => {
    render(<FamilyTitleSwitcher model={model} switcher={switcher} />);
    fireEvent.click(
      screen.getByRole("heading", { name: "All our days" }).closest("summary")!,
    );
    const family = screen.getByRole("link", { name: "All our days" });
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

  it("shows type pills, You first, and a check on the selected row only", () => {
    const { container } = render(
      <FamilyTitleSwitcher model={model} switcher={switcher} />,
    );
    fireEvent.click(
      screen.getByRole("heading", { name: "All our days" }).closest("summary")!,
    );
    const links = [
      ...container.querySelectorAll(".title-switcher nav a"),
    ] as HTMLAnchorElement[];
    expect(links.map((link) => link.textContent)).toEqual([
      "BrianYou",
      "All our daysGroup",
      "MollyPerson",
    ]);
    expect(links[0].querySelector(".title-switcher-check")).toBeNull();
    expect(links[1].querySelector(".title-switcher-check")).not.toBeNull();
    expect(links[2].querySelector(".title-switcher-check")).toBeNull();
    expect(
      container.querySelector(".title-lockup .title-switcher-type-pill"),
    ).toBeNull();
    expect(container.querySelector(".title-lockup .eyebrow")).toHaveTextContent(
      "Group",
    );
  });

  it("opens a required-name create form without leaving the switcher open state", () => {
    const action = vi.fn();
    const { container } = render(
      <FamilyTitleSwitcher
        model={model}
        switcher={switcher}
        createGroupAction={action}
      />,
    );
    fireEvent.click(
      screen.getByRole("heading", { name: "All our days" }).closest("summary")!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create group" }));
    expect(container.querySelector(".title-switcher")).toHaveAttribute("open");
    expect(screen.getByLabelText("Group name")).toBeRequired();
    expect(screen.getByRole("button", { name: "Create" })).toBeVisible();
    expect(action).not.toHaveBeenCalled();
  });

  it("closes the switcher on the same frame as a row press", () => {
    const { container } = render(
      <FamilyTitleSwitcher model={model} switcher={switcher} />,
    );
    fireEvent.click(
      screen.getByRole("heading", { name: "All our days" }).closest("summary")!,
    );
    expect(container.querySelector(".title-switcher")).toHaveAttribute("open");
    fireEvent.pointerDown(screen.getByRole("link", { name: "Molly" }), {
      button: 0,
    });
    expect(container.querySelector(".title-switcher")).not.toHaveAttribute(
      "open",
    );
    expect(container.querySelector(".title-switcher nav")).not.toHaveClass(
      "is-closing",
    );
    expect(screen.getByRole("heading", { name: "Molly" })).toBeVisible();
    expect(container.querySelector(".title-lockup .eyebrow")).toHaveTextContent(
      "Person",
    );
  });
});
