import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalInterrupted } from "./journal-interrupted";

afterEach(cleanup);

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
});
