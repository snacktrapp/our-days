import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  pendingChromeModel,
  RoutePendingSkeleton,
} from "./journal-pending-route";
import type { JournalChromeViewModel } from "./shell-view-model";

const model = {
  accent: "teal",
  eyebrow: "Our family",
  title: "All our days",
} as JournalChromeViewModel;

describe("route pending skeleton", () => {
  it("paints a quiet timeline rail instead of holding the last journal", () => {
    const { container } = render(<RoutePendingSkeleton kind="timeline" />);
    expect(
      screen.getByRole("region", { name: "Opening this journal" }),
    ).toHaveClass("timeline", "route-pending-skeleton");
    expect(container.querySelector(".time-rail")).not.toBeNull();
    expect(container.querySelectorAll(".route-pending-card")).toHaveLength(3);
    expect(container.querySelector(".timeline-empty-state")).toBeNull();
  });

  it("keeps Account on the graph-paper field without empty boxes", () => {
    const { container } = render(<RoutePendingSkeleton kind="settings" />);
    const account = screen.getByRole("region", { name: "Opening account" });
    expect(account).toHaveClass(
      "route-pending-field",
      "route-pending-skeleton",
    );
    expect(account.childElementCount).toBe(0);
    expect(account).not.toHaveClass("route-pending-glow");
    expect(container.querySelector(".route-pending-glow")).toBeNull();
    expect(container.querySelector(".route-pending-row")).toBeNull();
    expect(container.querySelector(".route-pending-card")).toBeNull();
  });

  it("updates destination titles without inventing an empty journal", () => {
    expect(
      pendingChromeModel(model, { href: "/people", kind: "settings" }).title,
    ).toBe("Account");
    expect(
      pendingChromeModel(model, { href: "/settings/family", kind: "settings" })
        .title,
    ).toBe("Account");
    expect(
      pendingChromeModel(model, { href: "/people/molly", kind: "timeline" })
        .title,
    ).toBe("All our days");
  });
});
