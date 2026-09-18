import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  pendingChromeModel,
  RoutePendingSkeleton,
  JournalPendingRouteProvider,
  usePendingJournalRoute,
} from "./journal-pending-route";
import type { JournalChromeViewModel } from "./shell-view-model";

const route = vi.hoisted(() => ({ pathname: "/family" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

function PendingContent() {
  const pending = usePendingJournalRoute()?.pending;
  return <span>{pending ? `Opening ${pending.href}` : "Journal content"}</span>;
}

it("does not revive an old loading state after navigating back", () => {
  route.pathname = "/family";
  const tree = () => (
    <JournalPendingRouteProvider>
      <PendingContent />
    </JournalPendingRouteProvider>
  );
  const view = render(tree());
  act(() => {
    window.dispatchEvent(
      new CustomEvent("our-days:navigate-section", {
        detail: { href: "/people/molly" },
      }),
    );
  });
  expect(screen.getByText("Opening /people/molly")).toBeVisible();
  route.pathname = "/people/molly";
  view.rerender(tree());
  expect(screen.getByText("Journal content")).toBeVisible();
  route.pathname = "/family";
  view.rerender(tree());
  expect(screen.getByText("Journal content")).toBeVisible();
});

const model = {
  accent: "teal",
  eyebrow: "Our family",
  title: "All our days",
} as JournalChromeViewModel;

describe("route pending skeleton", () => {
  it("leaves only the background grid while a journal loads", () => {
    const { container } = render(<RoutePendingSkeleton kind="timeline" />);
    expect(
      screen.getByRole("region", { name: "Opening this journal" }),
    ).toHaveClass("route-pending-field", "route-pending-skeleton");
    expect(container.querySelector(".time-rail")).toBeNull();
    expect(container.querySelectorAll(".route-pending-card")).toHaveLength(0);
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
