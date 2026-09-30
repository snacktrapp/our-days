import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  accentStorageKey,
  appearanceStorageKey,
  readPrefs,
  readPrefsSync,
  themeStorageKey,
  writePref,
  type AppearancePrefs,
} from "./appearance";
import {
  themeColors,
  type AccentId,
  type AppearanceId,
  type ColorScheme,
  type ThemeColors,
} from "./tokens";

type ThemeValue = AppearancePrefs &
  Readonly<{
    colors: ThemeColors;
    setScheme: (scheme: ColorScheme) => void;
    setAppearance: (appearance: AppearanceId) => void;
    setAccent: (accent: AccentId) => void;
    /** Header control. Future is dark-only, matching retro.css + the bootstrap. */
    toggleScheme: () => void;
  }>;

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [prefs, setPrefs] = useState<AppearancePrefs>(readPrefsSync);

  useEffect(() => {
    let active = true;
    readPrefs().then((next) => {
      if (active) setPrefs(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const setScheme = useCallback((scheme: ColorScheme) => {
    setPrefs((current) => ({ ...current, scheme }));
    void writePref(themeStorageKey, scheme);
  }, []);

  const setAppearance = useCallback((appearance: AppearanceId) => {
    setPrefs((current) => ({ ...current, appearance }));
    void writePref(appearanceStorageKey, appearance);
  }, []);

  const setAccent = useCallback((accent: AccentId) => {
    setPrefs((current) => ({ ...current, accent }));
    void writePref(accentStorageKey, accent);
  }, []);

  const toggleScheme = useCallback(() => {
    setPrefs((current) => {
      if (current.appearance === "retro") {
        void writePref(appearanceStorageKey, "standard");
        void writePref(themeStorageKey, "light");
        return { ...current, appearance: "standard", scheme: "light" };
      }
      const scheme = current.scheme === "dark" ? "light" : "dark";
      void writePref(themeStorageKey, scheme);
      return { ...current, scheme };
    });
  }, []);

  const value = useMemo<ThemeValue>(() => {
    const colors = themeColors(prefs.appearance, prefs.scheme, prefs.accent);
    return {
      ...prefs,
      colors,
      setScheme,
      setAppearance,
      setAccent,
      toggleScheme,
    };
  }, [prefs, setAccent, setAppearance, setScheme, toggleScheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider is missing");
  return value;
}

/** Dark standard palette for screens that render before the provider (none today). */
export const colors = themeColors("standard", "dark", "orange");
