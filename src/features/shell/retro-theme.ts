import {
  JOURNAL_THEME_EVENT,
  JOURNAL_THEME_STORAGE_KEY,
} from "./journal-theme";

export const APPEARANCE_STORAGE_KEY = "our-days-appearance";
export const ACCENT_STORAGE_KEY = "our-days-accent";
export const APPEARANCE_EVENT = "our-days:appearance-change";
export const ACCENT_EVENT = "our-days:accent-change";

/** Warm near-black used by Retro for the page and the Safari theme-color. */
export const RETRO_BACKGROUND = "#14110f";

/** Viewport colors from the root layout. Standard leaves these alone. */
export const STANDARD_THEME_COLOR = {
  light: "#edf0f4",
  dark: "#101216",
} as const;

export const accentPresets = [
  { id: "orange", name: "Orange" },
  { id: "green", name: "Green" },
  { id: "amber", name: "Amber" },
  { id: "blue", name: "Blue" },
  { id: "pink", name: "Pink" },
  { id: "violet", name: "Violet" },
] as const;

export type AccentId = (typeof accentPresets)[number]["id"];
export type AppearanceId = "standard" | "retro";

const accentIds = new Set<string>(accentPresets.map((preset) => preset.id));

export function isAccentId(
  value: string | null | undefined,
): value is AccentId {
  return value != null && accentIds.has(value);
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode can reject storage. The root attributes still update.
  }
}

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readAppearance(): AppearanceId {
  if (typeof document === "undefined") return "standard";
  return document.documentElement.dataset.appearance === "retro"
    ? "retro"
    : "standard";
}

export function readAccent(): AccentId {
  if (typeof document === "undefined") return "orange";
  const selected = document.documentElement.dataset.accent;
  return isAccentId(selected) ? selected : "orange";
}

export function readStoredJournalTheme(): "light" | "dark" {
  const saved = readStorage(JOURNAL_THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  if (typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function subscribeAppearance(onChange: () => void) {
  window.addEventListener(APPEARANCE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(APPEARANCE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function subscribeAccent(onChange: () => void) {
  window.addEventListener(ACCENT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(ACCENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function publish(name: string) {
  window.dispatchEvent(new Event(name));
}

/** Safari theme-color follows Retro only while that appearance is active. */
export function paintThemeColor(appearance: AppearanceId) {
  const metas = document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  for (const meta of metas) {
    if (meta.hasAttribute("data-overlay-chrome")) continue;
    if (appearance === "retro") {
      meta.setAttribute("content", RETRO_BACKGROUND);
      continue;
    }
    const media = meta.getAttribute("media") ?? "";
    meta.setAttribute(
      "content",
      media.includes("light")
        ? STANDARD_THEME_COLOR.light
        : STANDARD_THEME_COLOR.dark,
    );
  }
}

function applyStoredAccent() {
  const saved = readStorage(ACCENT_STORAGE_KEY);
  if (isAccentId(saved)) document.documentElement.dataset.accent = saved;
  else delete document.documentElement.dataset.accent;
}

/**
 * Apply a preset on the root element. No inline style, so CSP style-src-attr
 * stays closed. Standard ignores the saved accent until Retro is on again.
 */
export function applyAccent(id: AccentId) {
  document.documentElement.dataset.accent = id;
  writeStorage(ACCENT_STORAGE_KEY, id);
  publish(ACCENT_EVENT);
}

/** Drop the saved preset so Retro's default orange is used. */
export function resetAccent() {
  delete document.documentElement.dataset.accent;
  writeStorage(ACCENT_STORAGE_KEY, null);
  publish(ACCENT_EVENT);
}

export function applyAppearance(appearance: AppearanceId) {
  const root = document.documentElement;
  if (appearance === "retro") {
    root.dataset.appearance = "retro";
    root.dataset.theme = "dark";
    applyStoredAccent();
    writeStorage(APPEARANCE_STORAGE_KEY, "retro");
  } else {
    delete root.dataset.appearance;
    delete root.dataset.accent;
    root.dataset.theme = readStoredJournalTheme();
    writeStorage(APPEARANCE_STORAGE_KEY, "standard");
  }
  paintThemeColor(appearance);
  publish(APPEARANCE_EVENT);
  publish(ACCENT_EVENT);
  publish(JOURNAL_THEME_EVENT);
}

/**
 * Runs from the root layout before first paint.
 * Restores Standard light/dark, or Retro plus its accent, without a flash.
 * Retro forces data-theme="dark" for the paint only and leaves the saved
 * Standard choice in localStorage.
 */
export function themeBootstrapScript() {
  const ids = accentPresets.map((preset) => preset.id).join("|");
  return `try {
    var savedTheme = window.localStorage.getItem("${JOURNAL_THEME_STORAGE_KEY}");
    var theme = savedTheme === "light" || savedTheme === "dark"
      ? savedTheme
      : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    var appearance = window.localStorage.getItem("${APPEARANCE_STORAGE_KEY}");
    if (appearance === "retro") {
      document.documentElement.dataset.appearance = "retro";
      document.documentElement.dataset.theme = "dark";
      var savedAccent = window.localStorage.getItem("${ACCENT_STORAGE_KEY}");
      if (savedAccent && /^(?:${ids})$/.test(savedAccent)) {
        document.documentElement.dataset.accent = savedAccent;
      } else {
        delete document.documentElement.dataset.accent;
      }
      var themeMetas = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < themeMetas.length; i++) {
        if (!themeMetas[i].hasAttribute("data-overlay-chrome")) {
          themeMetas[i].setAttribute("content", "${RETRO_BACKGROUND}");
        }
      }
    } else {
      delete document.documentElement.dataset.appearance;
      delete document.documentElement.dataset.accent;
      document.documentElement.dataset.theme = theme;
    }
  } catch (_) {
    document.documentElement.dataset.theme = "dark";
  }
  ${focusModalityScript()}`;
}

/**
 * Distinguishes real keyboard navigation from taps and programmatic focus.
 * WebKit reports both as :focus-visible, so Future's accent ring is gated on
 * data-modality="keyboard". Pointer and touch clear that flag before focus
 * moves, including when a sheet restores focus to its trigger.
 */
export function focusModalityScript() {
  return `(function () {
    try {
      var root = document.documentElement;
      var keyboardKeys = {
        Tab: 1,
        Escape: 1,
        ArrowUp: 1,
        ArrowDown: 1,
        ArrowLeft: 1,
        ArrowRight: 1,
        Home: 1,
        End: 1,
        PageUp: 1,
        PageDown: 1
      };
      document.addEventListener("keydown", function (event) {
        if (event.metaKey || event.altKey || event.ctrlKey) return;
        if (keyboardKeys[event.key]) root.dataset.modality = "keyboard";
      }, true);
      var markPointer = function () {
        root.dataset.modality = "pointer";
      };
      document.addEventListener("pointerdown", markPointer, true);
      document.addEventListener("mousedown", markPointer, true);
      document.addEventListener("touchstart", markPointer, true);
    } catch (_) {}
  })();`;
}
