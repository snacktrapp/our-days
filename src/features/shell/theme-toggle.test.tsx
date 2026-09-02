import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "./theme-toggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.dataset.theme = "dark";
  });

  it("switches and persists the journal appearance", () => {
    render(<ThemeToggle />);

    const toggle = screen.getByRole("button", {
      name: "Use light appearance",
    });
    fireEvent.click(toggle);

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("our-days-theme")).toBe("light");
    expect(
      screen.getByRole("button", { name: "Use dark appearance" }),
    ).toBeInTheDocument();
  });

  it("reflects a light theme applied before hydration", () => {
    document.documentElement.dataset.theme = "light";

    render(<ThemeToggle />);

    expect(
      screen.getByRole("button", { name: "Use dark appearance" }),
    ).toBeInTheDocument();
  });
});
