import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FamilyTitleSwitcher } from "./family-title-switcher";
import type { JournalChromeViewModel } from "./shell-view-model";
import { sheetDismissThresholdPx } from "./use-sheet-dismiss";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

const model = {
  accent: "teal",
  eyebrow: "Circles",
  title: "All",
} as JournalChromeViewModel;

const switcher = [
  { kind: "you", label: "Brian", href: "/people/brian", current: false },
  { kind: "all", label: "All", href: "/family", current: true },
  {
    kind: "group",
    label: "Trapp Family",
    href: "/family?circle=family",
    current: false,
    circleId: "family",
  },
  { kind: "person", label: "Molly", href: "/people/molly", current: false },
] as const;

async function openSwitcher() {
  render(<FamilyTitleSwitcher model={model} switcher={switcher} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose a journal" }));
}

describe("FamilyTitleSwitcher", () => {
  afterEach(() => {
    navigation.push.mockClear();
  });

  it("opens a bottom sheet with a pull handle and three sections", async () => {
    await openSwitcher();
    const dialog = screen.getByRole("dialog", { name: "Journal" });
    expect(dialog).toHaveClass("composer-dialog");
    expect(dialog.querySelector(".activity-sheet")).toHaveClass(
      "composer-sheet",
    );
    expect(dialog.querySelector(".sheet-handle")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Just me" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Circles" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Person" })).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: "Choose a family timeline" }),
    ).toBeVisible();
  });

  it("dismisses the journal sheet with Escape and a reverse sheet motion", async () => {
    await openSwitcher();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Journal" }), {
      key: "Escape",
    });
    const sheet = document.querySelector(".activity-sheet");
    expect(sheet).toHaveClass("composer-sheet");
    expect(sheet).toHaveClass("is-closing");
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("dismisses the journal sheet instantly when motion is reduced", async () => {
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
      await openSwitcher();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog", { name: "Journal" })).toBeNull();
      expect(document.querySelector(".activity-sheet")).toBeNull();
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

  it("selects a journal row as soon as it is pressed and closes the sheet", async () => {
    await openSwitcher();
    const molly = screen.getByRole("link", { name: "Molly" });
    fireEvent.pointerDown(molly, { button: 0 });
    expect(molly).toHaveClass("active");
    expect(navigation.push).toHaveBeenCalledWith("/people/molly");
    expect(screen.queryByRole("dialog", { name: "Journal" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Molly" })).toBeVisible();
    expect(document.querySelector(".title-lockup .eyebrow")).toHaveTextContent(
      "Person",
    );
  });

  it("moves the current highlight to the pressed journal immediately", async () => {
    await openSwitcher();
    const all = screen.getByRole("link", { name: "All" });
    const molly = screen.getByRole("link", { name: "Molly" });
    expect(all).toHaveClass("active");
    expect(all).toHaveAttribute("aria-current", "page");

    fireEvent.pointerDown(molly, { button: 0 });

    expect(molly).toHaveClass("active");
    expect(molly).toHaveAttribute("aria-current", "page");
    expect(all).not.toHaveClass("active");
    expect(all).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { name: "Molly" })).toBeVisible();
  });

  it("keeps You first, All with circles, and a check on the selected row only", async () => {
    await openSwitcher();
    const links = [
      ...document.querySelectorAll(".title-switcher-sheet a"),
    ] as HTMLAnchorElement[];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Brian",
      "All",
      "Trapp Family",
      "Molly",
    ]);
    expect(links[0].querySelector(".title-switcher-check")).toBeNull();
    expect(links[1].querySelector(".title-switcher-check")).not.toBeNull();
    expect(links[2].querySelector(".title-switcher-check")).toBeNull();
    expect(
      document.querySelector(".title-lockup .title-switcher-type-pill"),
    ).toBeNull();
    expect(document.querySelector(".title-lockup .eyebrow")).toHaveTextContent(
      "Circles",
    );
  });

  it("syncs the header to All when the server current href becomes /family", async () => {
    const circleCurrent = switcher.map((item) =>
      item.kind === "group"
        ? { ...item, current: true }
        : { ...item, current: false },
    );
    const allCurrent = switcher.map((item) =>
      item.kind === "all"
        ? { ...item, current: true }
        : { ...item, current: false },
    );
    const { rerender } = render(
      <FamilyTitleSwitcher
        model={{ ...model, title: "Trapp Family", eyebrow: "Circles" }}
        switcher={circleCurrent}
      />,
    );
    expect(screen.getByRole("heading", { name: "Trapp Family" })).toBeVisible();
    rerender(
      <FamilyTitleSwitcher
        model={{ ...model, title: "All", eyebrow: "Circles" }}
        switcher={allCurrent}
      />,
    );
    expect(screen.getByRole("heading", { name: "All" })).toBeVisible();
    expect(document.querySelector(".title-lockup .eyebrow")).toHaveTextContent(
      "Circles",
    );
  });

  it("closes the sheet when the family current href changes", async () => {
    const { rerender } = render(
      <FamilyTitleSwitcher model={model} switcher={switcher} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose a journal" }));
    expect(screen.getByRole("dialog", { name: "Journal" })).toBeVisible();
    const circleCurrent = switcher.map((item) =>
      item.kind === "group"
        ? { ...item, current: true }
        : { ...item, current: false },
    );
    rerender(<FamilyTitleSwitcher model={model} switcher={circleCurrent} />);
    expect(screen.queryByRole("dialog", { name: "Journal" })).toBeNull();
  });

  it("treats a Journal bottom-nav to /family as All", async () => {
    const circleCurrent = switcher.map((item) =>
      item.kind === "group"
        ? { ...item, current: true }
        : { ...item, current: false },
    );
    render(
      <FamilyTitleSwitcher
        model={{ ...model, title: "Trapp Family", eyebrow: "Circles" }}
        switcher={circleCurrent}
      />,
    );
    expect(screen.getByRole("heading", { name: "Trapp Family" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Choose a journal" }));
    expect(screen.getByRole("dialog", { name: "Journal" })).toBeVisible();
    act(() => {
      window.dispatchEvent(
        new CustomEvent("our-days:navigate-section", {
          detail: { href: "/family" },
        }),
      );
    });
    expect(screen.getByRole("heading", { name: "All" })).toBeVisible();
    expect(document.querySelector(".title-lockup .eyebrow")).toHaveTextContent(
      "Circles",
    );
    expect(screen.queryByRole("dialog", { name: "Journal" })).toBeNull();
  });

  it("shows member counts on circle rows only", async () => {
    const counted = switcher.map((item) =>
      item.kind === "group" ? { ...item, memberCount: 3 } : item,
    );
    render(<FamilyTitleSwitcher model={model} switcher={counted} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a journal" }));
    const family = screen.getByRole("link", { name: "Trapp Family" });
    expect(
      family.querySelector(".title-switcher-member-count"),
    ).toHaveTextContent("3");
    expect(
      screen
        .getByRole("link", { name: "All" })
        .querySelector(".title-switcher-member-count"),
    ).toBeNull();
  });

  it("is a feed filter only and does not offer create or admin actions", async () => {
    await openSwitcher();
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

  it("dismisses when the sheet is dragged down from the handle", async () => {
    await openSwitcher();
    const handle = document.querySelector(".sheet-handle");
    const sheet = document.querySelector(".activity-sheet") as HTMLElement;
    expect(handle).not.toBeNull();
    fireEvent.pointerDown(handle!, { pointerId: 1, clientX: 40, clientY: 20 });
    fireEvent.pointerMove(sheet, {
      pointerId: 1,
      clientX: 40,
      clientY: 20 + sheetDismissThresholdPx,
    });
    fireEvent.pointerUp(sheet, {
      pointerId: 1,
      clientX: 40,
      clientY: 20 + sheetDismissThresholdPx,
    });
    expect(sheet).toHaveClass("is-closing");
  });
});
