export const ACCENT_STORAGE_KEY = "our-days-accent";
export const ACCENT_EVENT = "our-days:accent-change";

/** Warm near-black used by the terminal theme, status bar, and manifest. */
export const terminalBackground = "#14110f";

export const accentPresets = [
  { id: "orange", name: "Orange" },
  { id: "green", name: "Green" },
  { id: "amber", name: "Amber" },
  { id: "blue", name: "Blue" },
  { id: "pink", name: "Pink" },
  { id: "violet", name: "Violet" },
] as const;

export type AccentId = (typeof accentPresets)[number]["id"];

const accentIds = new Set<string>(accentPresets.map((preset) => preset.id));

export function isAccentId(
  value: string | null | undefined,
): value is AccentId {
  return value != null && accentIds.has(value);
}

export function readAccent(): AccentId {
  if (typeof document === "undefined") return "orange";
  const selected = document.documentElement.dataset.accent;
  return isAccentId(selected) ? selected : "orange";
}

export function subscribeAccent(onChange: () => void) {
  window.addEventListener(ACCENT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(ACCENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function publishAccent() {
  window.dispatchEvent(new Event(ACCENT_EVENT));
}

/** Apply a preset on the root element. No inline style, so CSP style-src-attr stays closed. */
export function applyAccent(id: AccentId) {
  document.documentElement.dataset.accent = id;
  window.localStorage.setItem(ACCENT_STORAGE_KEY, id);
  publishAccent();
}

/** Drop the saved preset so the theme block's default orange is used. */
export function resetAccent() {
  delete document.documentElement.dataset.accent;
  window.localStorage.removeItem(ACCENT_STORAGE_KEY);
  publishAccent();
}

/**
 * Runs from the root layout before first paint.
 * Forces the dark terminal theme and restores a saved accent without a flash.
 */
export function terminalThemeBootstrap() {
  const ids = accentPresets.map((preset) => preset.id).join("|");
  return `try {
    document.documentElement.dataset.theme = "dark";
    var savedAccent = window.localStorage.getItem("${ACCENT_STORAGE_KEY}");
    if (savedAccent && /^(?:${ids})$/.test(savedAccent)) {
      document.documentElement.dataset.accent = savedAccent;
    }
  } catch (error) {
    document.documentElement.dataset.theme = "dark";
  }`;
}
