import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RootError from "./error";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RootError", () => {
  it("keeps non-fatal errors on an opening shell", () => {
    render(<RootError error={new Error("Circle is unavailable")} />);

    expect(screen.getByLabelText("Opening this journal")).toBeVisible();
    expect(
      screen.queryByText("Something interrupted the story"),
    ).not.toBeInTheDocument();
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
