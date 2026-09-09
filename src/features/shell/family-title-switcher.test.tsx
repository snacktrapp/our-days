import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FamilyTitleSwitcher } from "./family-title-switcher";
import type { JournalChromeViewModel } from "./shell-view-model";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

const model = {
  accent: "teal",
  eyebrow: "Circle",
  title: "All our days",
} as JournalChromeViewModel;

const switcher = [
  { kind: "you", label: "Brian", href: "/people/brian", current: false },
  { kind: "group", label: "All our days", href: "/family", current: true },
  { kind: "person", label: "Molly", href: "/people/molly", current: false },
] as const;

describe("FamilyTitleSwitcher", () => {
  afterEach(() => {
    navigation.push.mockClear();
  });

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
    expect(navigation.push).toHaveBeenCalledWith("/people/molly");
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
      "All our daysCircle",
      "MollyPerson",
    ]);
    expect(links[0].querySelector(".title-switcher-check")).toBeNull();
    expect(links[1].querySelector(".title-switcher-check")).not.toBeNull();
    expect(links[2].querySelector(".title-switcher-check")).toBeNull();
    expect(
      container.querySelector(".title-lockup .title-switcher-type-pill"),
    ).toBeNull();
    expect(container.querySelector(".title-lockup .eyebrow")).toHaveTextContent(
      "Circle",
    );
  });

  it("is a feed filter only and does not offer create or admin actions", () => {
    const { container } = render(
      <FamilyTitleSwitcher model={model} switcher={switcher} />,
    );
    fireEvent.click(
      screen.getByRole("heading", { name: "All our days" }).closest("summary")!,
    );
    expect(container.querySelector(".title-switcher")).toHaveAttribute("open");
    expect(
      screen.queryByRole("button", { name: "Create group" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create circle" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Group name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name the ring")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create" }),
    ).not.toBeInTheDocument();
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

  it("does not let a row press click through to timeline media", () => {
    const openPhoto = vi.fn();
    render(
      <>
        <FamilyTitleSwitcher model={model} switcher={switcher} />
        <button
          type="button"
          className="photo-viewer-trigger"
          onClick={openPhoto}
        >
          Open photo
        </button>
      </>,
    );
    fireEvent.click(
      screen.getByRole("heading", { name: "All our days" }).closest("summary")!,
    );
    expect(document.querySelector(".title-switcher-scrim")).not.toBeNull();
    fireEvent.pointerDown(screen.getByRole("link", { name: "Molly" }), {
      button: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "Open photo" }));
    expect(openPhoto).not.toHaveBeenCalled();
    expect(navigation.push).toHaveBeenCalledWith("/people/molly");
  });

  it("blocks timeline media while the switcher is open", () => {
    const openPhoto = vi.fn();
    render(
      <>
        <FamilyTitleSwitcher model={model} switcher={switcher} />
        <button
          type="button"
          className="photo-viewer-trigger"
          onClick={openPhoto}
        >
          Open photo
        </button>
      </>,
    );
    fireEvent.click(
      screen.getByRole("heading", { name: "All our days" }).closest("summary")!,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Open photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Open photo" }));
    expect(openPhoto).not.toHaveBeenCalled();
    expect(document.querySelector(".title-switcher nav")).toHaveClass(
      "is-closing",
    );
  });
});
