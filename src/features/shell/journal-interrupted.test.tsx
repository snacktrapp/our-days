import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountPanelInterrupted,
  JournalInterrupted,
  JournalRefreshInterrupted,
} from "./journal-interrupted";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

describe("JournalInterrupted", () => {
  it("retries the journal without showing Next’s default error page", () => {
    const retry = vi.fn();
    render(<JournalInterrupted retry={retry} />);

    expect(screen.getByRole("heading", { name: "Our Days" })).toBeVisible();
    expect(screen.getByText("Something interrupted the story")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "This page couldn’t load" }),
    ).not.toBeInTheDocument();

    screen.getByRole("button", { name: "Try again" }).click();
    expect(retry).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("link", { name: "Back to Family" }),
    ).toHaveAttribute("href", "/family");
  });

  it("falls back to reset when retry is not provided", () => {
    const reset = vi.fn();
    render(<JournalInterrupted reset={reset} />);
    screen.getByRole("button", { name: "Try again" }).click();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("refreshes Account in place instead of showing Next’s crash page", () => {
    render(
      <AccountPanelInterrupted>
        <div data-testid="journal-tools">tools</div>
      </AccountPanelInterrupted>,
    );

    expect(
      screen.getByText("We couldn’t open Account just now."),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "This page couldn’t load" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("journal-tools")).toBeVisible();

    screen.getByRole("button", { name: "Try again" }).click();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("retries a warming journal session from the route boundary", () => {
    render(<JournalRefreshInterrupted />);
    screen.getByRole("button", { name: "Try again" }).click();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
