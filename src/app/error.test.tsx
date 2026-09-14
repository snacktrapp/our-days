import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RootError from "./error";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RootError", () => {
  it("keeps non-fatal errors on an actionable soft failure", () => {
    const retry = vi.fn();
    render(
      <RootError error={new Error("Circle is unavailable")} retry={retry} />,
    );

    expect(screen.getByText("These days couldn’t open")).toBeVisible();
    expect(
      screen.queryByText("Something interrupted the story"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Opening this journal"),
    ).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("keeps fatal integrity errors on the interrupt card", () => {
    render(<RootError error={new Error("Timeline snapshot is invalid")} />);

    expect(screen.getByText("Something interrupted the story")).toBeVisible();
  });

  it("rethrows Next control-flow errors so redirect handling can continue", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      render(
        <RootError
          error={Object.assign(new Error("Redirect"), {
            digest: "NEXT_REDIRECT;/sign-in",
          })}
        />,
      ),
    ).toThrow();
  });
});
