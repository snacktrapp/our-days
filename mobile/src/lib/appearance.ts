import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import {
  accentIds,
  type AccentId,
  type AppearanceId,
  type ColorScheme,
} from "./tokens";

/**
 * Same storage keys as the web app:
 *   src/features/shell/journal-theme.ts JOURNAL_THEME_STORAGE_KEY
 *   src/features/shell/retro-theme.ts APPEARANCE_STORAGE_KEY / ACCENT_STORAGE_KEY
 * Web uses localStorage. Native uses SecureStore. Expo web uses localStorage
 * so a browser comparison can share the keys with the Next app on this origin.
 */

export const themeStorageKey = "our-days-theme";
export const appearanceStorageKey = "our-days-appearance";
export const accentStorageKey = "our-days-accent";

export type AppearancePrefs = Readonly<{
  scheme: ColorScheme;
  appearance: AppearanceId;
  accent: AccentId;
}>;

export const defaultPrefs: AppearancePrefs = {
  scheme: "dark",
  appearance: "standard",
  accent: "orange",
};

function isAccent(value: string | null): value is AccentId {
  return value != null && (accentIds as readonly string[]).includes(value);
}

function normalize(
  scheme: string | null,
  appearance: string | null,
  accent: string | null,
): AppearancePrefs {
  return {
    scheme: scheme === "light" ? "light" : "dark",
    appearance: appearance === "retro" ? "retro" : "standard",
    accent: isAccent(accent) ? accent : "orange",
  };
}

function webGet(key: string) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function webSet(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Private mode can reject storage. The in-memory theme still updates.
  }
}

export function readPrefsSync(): AppearancePrefs {
  if (Platform.OS !== "web") return defaultPrefs;
  return normalize(
    webGet(themeStorageKey),
    webGet(appearanceStorageKey),
    webGet(accentStorageKey),
  );
}

async function readNative(key: string) {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeNative(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // The in-memory theme still updates for this launch.
  }
}

export async function readPrefs(): Promise<AppearancePrefs> {
  if (Platform.OS === "web") return readPrefsSync();
  const [scheme, appearance, accent] = await Promise.all([
    readNative(themeStorageKey),
    readNative(appearanceStorageKey),
    readNative(accentStorageKey),
  ]);
  return normalize(scheme, appearance, accent);
}

export async function writePref(key: string, value: string) {
  if (Platform.OS === "web") {
    webSet(key, value);
    return;
  }
  await writeNative(key, value);
}
