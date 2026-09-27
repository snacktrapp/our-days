"use client";

import { useSyncExternalStore } from "react";
import {
  JOURNAL_THEME_EVENT,
  JOURNAL_THEME_STORAGE_KEY,
} from "./journal-theme";

type JournalTheme = "dark" | "light";

function applyTheme(theme: JournalTheme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(JOURNAL_THEME_STORAGE_KEY, theme);
  window.dispatchEvent(new Event(JOURNAL_THEME_EVENT));
}

function currentTheme(): JournalTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener(JOURNAL_THEME_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(JOURNAL_THEME_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "dark");

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={`Use ${nextTheme} appearance`}
      title={`Use ${nextTheme} appearance`}
      onClick={() => {
        applyTheme(nextTheme);
      }}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3.75" />
          <path d="M12 2.75v2M12 19.25v2M2.75 12h2M19.25 12h2M5.46 5.46l1.42 1.42M17.12 17.12l1.42 1.42M18.54 5.46l-1.42 1.42M6.88 17.12l-1.42 1.42" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19.4 15.1A7.8 7.8 0 0 1 8.9 4.6 7.8 7.8 0 1 0 19.4 15.1Z" />
        </svg>
      )}
    </button>
  );
}
