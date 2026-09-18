import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  eyebrow: "Circles",
  title: "All circles",
} as JournalChromeViewModel;

const switcher = [
  { kind: "you", label: "Brian", href: "/people/brian", current: false },
  { kind: "all", label: "All circles", href: "/family", current: true },
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
    sessionStorage.clear();
  });

  it("opens a compact inline selector with only two choices", async () => {
    await openSwitcher();
    const menu = screen.getByRole("navigation", {
      name: "Choose a family timeline",
    });
    expect(menu.parentElement).toHaveClass("title-switcher");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      Array.from(menu.querySelectorAll("a")).map((a) => a.textContent),
    ).toEqual(["Just me", "All circles"]);
    expect(screen.getByRole("link", { name: "All circles" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(document.querySelector(".sheet-handle")).toBeNull();
  });

  it("closes on a second tap", async () => {
    await openSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Choose a journal" }));
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("closes on an outside tap", async () => {
    await openSwitcher();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("closes with Escape and returns focus to the header", async () => {
    await openSwitcher();
    const choice = screen.getByRole("link", { name: "Just me" });
    choice.focus();
    fireEvent.keyDown(choice, { key: "Escape" });
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Choose a journal" }),
    ).toHaveFocus();
  });

  it("allows keyboard navigation without trapping focus", async () => {
    const user = userEvent.setup();
    await openSwitcher();
    const trigger = screen.getByRole("button", { name: "Choose a journal" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("link", { name: "Just me" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("link", { name: "All circles" })).toHaveFocus();
    await user.tab();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("chooses a feed and remembers it without opening a modal", async () => {
    await openSwitcher();
    fireEvent.click(screen.getByRole("link", { name: "Just me" }));
    expect(navigation.push).toHaveBeenCalledWith("/people/brian");
    expect(sessionStorage.getItem("our-days:primary-feed")).toBe("you");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("heading", { name: "Just me" })).toBeVisible();
  });

  it("closes when the server destination changes", async () => {
    const { rerender } = render(
      <FamilyTitleSwitcher model={model} switcher={switcher} />,
    );
    fireEvent.click(screen.getByRole("button"));
    rerender(
      <FamilyTitleSwitcher
        model={model}
        switcher={switcher.map((item) => ({
          ...item,
          current: item.kind === "you",
        }))}
      />,
    );
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("heading", { name: "Just me" })).toBeVisible();
    rerender(<FamilyTitleSwitcher model={model} switcher={switcher} />);
    expect(screen.getByRole("heading", { name: "All circles" })).toBeVisible();
  });
});
