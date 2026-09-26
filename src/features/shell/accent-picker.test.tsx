import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AccentPicker } from "./accent-picker";
import { ACCENT_STORAGE_KEY, terminalThemeBootstrap } from "./terminal-accent";

describe("terminal accent", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.accent;
    document.documentElement.dataset.theme = "light";
    document.documentElement.removeAttribute("style");
  });

  it("restores a saved accent before paint and stays dark", () => {
    window.localStorage.setItem("our-days-theme", "light");
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "violet");

    new Function(terminalThemeBootstrap())();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("violet");
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });

  it("ignores an unknown saved accent", () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "neon");

    new Function(terminalThemeBootstrap())();

    expect(document.documentElement.dataset.accent).toBeUndefined();
  });

  it("changes the accent live and persists it", () => {
    render(<AccentPicker />);

    fireEvent.click(screen.getByRole("radio", { name: "Green" }));

    expect(document.documentElement.dataset.accent).toBe("green");
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("green");
    expect(screen.getByRole("radio", { name: "Green" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });

  it("resets to the default orange preset", () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "pink");
    document.documentElement.dataset.accent = "pink";
    render(<AccentPicker />);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(document.documentElement.dataset.accent).toBeUndefined();
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("radio", { name: "Orange" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
