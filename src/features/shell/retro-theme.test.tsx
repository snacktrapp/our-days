import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AppearanceSettings } from "./appearance-settings";
import { AccentPicker } from "./accent-picker";
import { JOURNAL_THEME_STORAGE_KEY } from "./journal-theme";
import {
  ACCENT_STORAGE_KEY,
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  themeBootstrapScript,
} from "./retro-theme";

function runBootstrap() {
  new Function(themeBootstrapScript())();
}

describe("retro theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.appearance;
    delete document.documentElement.dataset.accent;
    document.documentElement.dataset.theme = "dark";
    document.documentElement.removeAttribute("style");
    document.head
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.remove());
  });

  it("keeps Standard on the saved light/dark theme and ignores a saved accent", () => {
    window.localStorage.setItem(JOURNAL_THEME_STORAGE_KEY, "light");
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "violet");

    runBootstrap();

    expect(document.documentElement.dataset.appearance).toBeUndefined();
    expect(document.documentElement.dataset.accent).toBeUndefined();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });

  it("restores Retro and its accent before paint without rewriting the Standard theme", () => {
    window.localStorage.setItem(JOURNAL_THEME_STORAGE_KEY, "light");
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "retro");
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "violet");
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#101216";
    document.head.appendChild(meta);

    runBootstrap();

    expect(document.documentElement.dataset.appearance).toBe("retro");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("violet");
    expect(window.localStorage.getItem(JOURNAL_THEME_STORAGE_KEY)).toBe(
      "light",
    );
    expect(meta.getAttribute("content")).toBe("#14110f");
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });

  it("ignores an unknown saved accent", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "retro");
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "neon");

    runBootstrap();

    expect(document.documentElement.dataset.accent).toBeUndefined();
  });

  it("leaves an overlay-owned theme-color alone", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "retro");
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#000000";
    meta.setAttribute("data-overlay-chrome", "#101216");
    document.head.appendChild(meta);

    runBootstrap();

    expect(meta.getAttribute("content")).toBe("#000000");
  });

  it("shows the accent picker only while Retro is selected", () => {
    render(<AppearanceSettings />);

    expect(screen.getByRole("radio", { name: "Standard" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByRole("radio", { name: "Orange" })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Future" }));

    expect(document.documentElement.dataset.appearance).toBe("retro");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("retro");
    expect(screen.getByRole("radio", { name: "Orange" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByRole("radio", { name: "Accent" })).toBeNull();
  });

  it("returns to the saved Standard theme and stops applying the accent", () => {
    window.localStorage.setItem(JOURNAL_THEME_STORAGE_KEY, "light");
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "pink");
    document.documentElement.dataset.appearance = "retro";
    document.documentElement.dataset.accent = "pink";
    document.documentElement.dataset.theme = "dark";
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.setAttribute("media", "(prefers-color-scheme: light)");
    meta.content = "#14110f";
    document.head.appendChild(meta);
    render(<AppearanceSettings />);

    fireEvent.click(screen.getByRole("radio", { name: "Standard" }));

    expect(document.documentElement.dataset.appearance).toBeUndefined();
    expect(document.documentElement.dataset.accent).toBeUndefined();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("pink");
    expect(meta.getAttribute("content")).toBe("#edf0f4");
    expect(screen.queryByRole("radio", { name: "Pink" })).toBeNull();
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

  it("applies Retro immediately from a stored light theme", () => {
    window.localStorage.setItem(JOURNAL_THEME_STORAGE_KEY, "light");
    document.documentElement.dataset.theme = "light";

    applyAppearance("retro");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(JOURNAL_THEME_STORAGE_KEY)).toBe(
      "light",
    );
  });
});
