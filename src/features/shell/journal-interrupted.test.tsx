import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountPanelInterrupted,
  JournalInterrupted,
  JournalOpenUnavailable,
  JournalRefreshInterrupted,
} from "./journal-interrupted";
import {
  JournalSegmentError,
  shouldAutoRetryJournalRoute,
} from "./journal-route-boundary";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  cleanup();
  refresh.mockClear();
  sessionStorage.removeItem("our-days:journal-nav-auto-retry");
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

    expect(screen.getByText("These days couldn’t open")).toBeVisible();
    expect(
      screen.getByText("We couldn’t open Account just now."),
    ).toBeVisible();
    expect(
      screen.queryByText("Something interrupted the story"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "This page couldn’t load" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("journal-tools")).toBeVisible();

    screen.getByRole("button", { name: "Try again" }).click();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps a terminal open failure actionable without the interrupt copy", () => {
    const retry = vi.fn();
    render(<JournalOpenUnavailable retry={retry} />);

    expect(screen.getByText("These days couldn’t open")).toBeVisible();
    expect(
      screen.queryByText("Something interrupted the story"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Opening this journal"),
    ).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });

  it("retries a warming journal session from the route boundary", () => {
    render(<JournalRefreshInterrupted />);
    screen.getByRole("button", { name: "Try again" }).click();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("auto-retries an aborted Account→Journal remount instead of the interrupt card", () => {
    expect(
      shouldAutoRetryJournalRoute(
        Object.assign(new Error("The operation was aborted."), {
          name: "AbortError",
        }),
      ),
    ).toBe(true);
    expect(
      shouldAutoRetryJournalRoute(new Error("Circle is unavailable")),
    ).toBe(false);
  });

  it("auto-retries a recoverable All-circles refresh miss instead of the interrupt card", () => {
    expect(
      shouldAutoRetryJournalRoute({
        code: "PGRST301",
        message: "JWT expired",
      }),
    ).toBe(true);
    expect(shouldAutoRetryJournalRoute(new Error("Failed to fetch"))).toBe(
      true,
    );
    expect(
      shouldAutoRetryJournalRoute(new Error("Circle is unavailable")),
    ).toBe(false);
  });

  it("auto-retries a layout remount abort from the segment error view", () => {
    const retry = vi.fn();
    render(
      <JournalSegmentError
        error={Object.assign(new Error("The operation was aborted."), {
          name: "AbortError",
        })}
        retry={retry}
      />,
    );

    expect(
      screen.queryByText("Something interrupted the story"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Family journal")).toBeVisible();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("auto-retries a layout refresh JWT miss from the segment error view", () => {
    const retry = vi.fn();
    render(
      <JournalSegmentError
        error={Object.assign(new Error("JWT expired"), { code: "PGRST301" })}
        retry={retry}
      />,
    );

    expect(
      screen.queryByText("Something interrupted the story"),
    ).not.toBeInTheDocument();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("keeps a fatal layout error on the interrupt card", () => {
    const retry = vi.fn();
    render(
      <JournalSegmentError
        error={new Error("Timeline snapshot is invalid")}
        retry={retry}
      />,
    );

    expect(screen.getByText("Something interrupted the story")).toBeVisible();
    expect(retry).not.toHaveBeenCalled();
  });

  it("keeps non-fatal layout errors on an actionable soft failure", () => {
    const retry = vi.fn();
    render(
      <JournalSegmentError
        error={new Error("Circle is unavailable")}
        retry={retry}
      />,
    );

    expect(
      screen.queryByText("Something interrupted the story"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("These days couldn’t open")).toBeVisible();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("rethrows Next control-flow errors so redirects are handled by Next", () => {
    expect(() =>
      render(
        <JournalSegmentError
          error={Object.assign(new Error("Redirect"), {
            digest: "NEXT_REDIRECT;/sign-in",
          })}
          retry={vi.fn()}
        />,
      ),
    ).toThrow();
  });
});
