import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activityPageSize, NotificationCenter } from "./notification-center";
import { sheetDismissThresholdPx } from "./use-sheet-dismiss";

const items = [
  {
    id: "note-one",
    actorName: "Molly",
    message: "commented on your photo.",
    displayDate: "Today",
    href: "/family#moment-one",
  },
] as const;

function longHistory() {
  return Array.from({ length: activityPageSize + 5 }, (_, index) => ({
    id: `note-${index}`,
    actorName: "Molly",
    message: `commented on photo ${index + 1}.`,
    displayDate: "Today",
    href: `/family#moment-${index}`,
  }));
}

async function openActivity() {
  const user = userEvent.setup();
  const view = render(<NotificationCenter items={items} />);
  await user.click(screen.getByRole("button", { name: /Open notifications/u }));
  return { user, ...view };
}

describe("NotificationCenter", () => {
  beforeEach(() => window.localStorage.clear());

  it("opens activity as a tall sheet and clears the unread indicator", async () => {
    const { user } = await openActivity();
    const dialog = screen.getByRole("dialog", { name: "Activity" });
    expect(dialog).toHaveClass("composer-dialog");
    expect(dialog.querySelector(".activity-sheet")).toHaveClass(
      "composer-sheet",
    );
    expect(dialog.querySelector(".sheet-handle")).not.toBeNull();
    expect(dialog).not.toHaveClass("overlay-popover");
    expect(document.querySelector(".notification-panel")).toBeNull();
    expect(dialog).toHaveTextContent("Molly commented on your photo.");
    expect(
      screen.getByRole("button", { name: "Open notifications" }),
    ).toHaveAccessibleName("Open notifications");
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(
      window.localStorage.getItem("our-days:seen-notifications"),
    ).toContain("note-one");
    expect(document.body).toHaveClass("composer-scroll-locked");
    await user.click(screen.getByRole("link", { name: /Molly/u }));
    expect(screen.queryByRole("dialog", { name: "Activity" })).toBeNull();
  });

  it("dismisses the activity sheet with Escape and a reverse sheet motion", async () => {
    const { user } = await openActivity();
    await user.keyboard("{Escape}");
    const sheet = document.querySelector(".activity-sheet");
    expect(sheet).toHaveClass("composer-sheet");
    expect(sheet).toHaveClass("is-closing");
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("dismisses the activity sheet instantly when motion is reduced", async () => {
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
      const { user } = await openActivity();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog", { name: "Activity" })).toBeNull();
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

  it("pages a long history inside the sheet", async () => {
    const user = userEvent.setup();
    render(<NotificationCenter items={longHistory()} />);
    await user.click(
      screen.getByRole("button", { name: /Open notifications/u }),
    );
    expect(screen.getAllByRole("link")).toHaveLength(activityPageSize);
    await user.click(screen.getByRole("button", { name: "Earlier activity" }));
    expect(screen.getAllByRole("link")).toHaveLength(activityPageSize + 5);
    expect(
      screen.queryByRole("button", { name: "Earlier activity" }),
    ).toBeNull();
  });

  it("dismisses when the sheet is dragged down from the handle", async () => {
    await openActivity();
    const handle = document.querySelector(".sheet-handle");
    const sheet = document.querySelector(".activity-sheet") as HTMLElement;
    expect(handle).not.toBeNull();
    expect(sheet).not.toBeNull();
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
    expect(sheet.style.getPropertyValue("--activity-sheet-drag")).toBe(
      `${sheetDismissThresholdPx}px`,
    );
  });

  it("dismisses a downward pull when the list is scrolled to the top", async () => {
    await openActivity();
    const sheet = document.querySelector(".activity-sheet") as HTMLElement;
    const list = document.querySelector(".activity-sheet-list") as HTMLElement;
    Object.defineProperty(list, "scrollTop", { configurable: true, value: 0 });
    fireEvent.pointerDown(list, { pointerId: 3, clientX: 40, clientY: 80 });
    fireEvent.pointerMove(sheet, {
      pointerId: 3,
      clientX: 40,
      clientY: 80 + sheetDismissThresholdPx,
    });
    fireEvent.pointerUp(sheet, {
      pointerId: 3,
      clientX: 40,
      clientY: 80 + sheetDismissThresholdPx,
    });
    expect(sheet).toHaveClass("is-closing");
    expect(sheet.style.getPropertyValue("--activity-sheet-drag")).toBe(
      `${sheetDismissThresholdPx}px`,
    );
  });

  it("keeps a cancelled drag from restarting open motion", async () => {
    await openActivity();
    const sheet = document.querySelector(".activity-sheet") as HTMLElement;
    fireEvent.pointerDown(sheet, { pointerId: 2, clientX: 40, clientY: 20 });
    fireEvent.pointerMove(sheet, {
      pointerId: 2,
      clientX: 40,
      clientY: 40,
    });
    fireEvent.pointerUp(sheet, { pointerId: 2, clientX: 40, clientY: 40 });
    expect(sheet).not.toHaveClass("is-closing");
    expect(sheet).not.toHaveClass("is-dragging");
    expect(sheet.style.getPropertyValue("--activity-sheet-drag")).toBe("");
  });

  it("does not reopen Activity when the heart is tapped during close", async () => {
    const { user } = await openActivity();
    await user.keyboard("{Escape}");
    const sheet = document.querySelector(".activity-sheet");
    expect(sheet).toHaveClass("is-closing");
    await user.click(
      screen.getByRole("button", { name: "Open notifications" }),
    );
    expect(document.querySelector(".activity-sheet")).toHaveClass("is-closing");
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
