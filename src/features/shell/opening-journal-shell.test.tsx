import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OpeningJournalShell } from "./opening-journal-shell";

describe("OpeningJournalShell", () => {
  it("paints top and bottom chrome without waiting for a timeline page", () => {
    const { container } = render(<OpeningJournalShell />);

    expect(screen.getByRole("heading", { name: "All circles" })).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Journal" })).toHaveAttribute(
      "href",
      "/family",
    );
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/settings/family",
    );
    expect(
      screen.getByRole("region", { name: "Opening this journal" }),
    ).toHaveClass("route-pending-skeleton");
    expect(container.querySelector(".topbar")).not.toBeNull();
    expect(container.querySelector(".bottom-nav")).not.toBeNull();
    expect(container.querySelector(".moment")).toBeNull();
    expect(container.querySelector(".photo-status-shelf")).toBeNull();
  });
});
