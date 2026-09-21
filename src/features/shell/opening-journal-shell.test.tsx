import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpeningJournalShell } from "./opening-journal-shell";
import { PersistentJournalShell } from "./journal-chrome";

vi.mock("next/navigation", () => ({
  usePathname: () => "/family",
  useRouter: () => ({ push: vi.fn() }),
}));

describe("OpeningJournalShell", () => {
  it("paints top and bottom chrome without waiting for a timeline page", () => {
    const { container } = render(
      <PersistentJournalShell>
        <OpeningJournalShell />
      </PersistentJournalShell>,
    );

    expect(screen.getByRole("img", { name: "Our Days" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Journal" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Journal" })).toHaveAttribute(
      "href",
      "/family",
    );
    expect(screen.getByRole("link", { name: "Circles" })).toHaveAttribute(
      "href",
      "/circles",
    );
    expect(
      screen.getByRole("region", { name: "Opening this journal" }),
    ).toHaveClass("route-pending-skeleton");
    expect(container.querySelector(".topbar")).not.toBeNull();
    expect(container.querySelector(".bottom-nav")).not.toBeNull();
    const icons = container.querySelectorAll(".bottom-nav .nav-symbol svg");
    expect(icons).toHaveLength(3);
    for (const icon of icons) {
      expect(icon.children.length).toBeGreaterThan(0);
      expect(icon).toHaveAttribute("viewBox", "0 0 24 24");
    }
    expect(container.querySelector(".moment")).toBeNull();
    expect(
      container.querySelector(".time-rail, .route-pending-card"),
    ).toBeNull();
    expect(container.querySelector(".photo-status-shelf")).toBeNull();
  });
});
