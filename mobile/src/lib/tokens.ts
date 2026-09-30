import { Platform, type TextStyle } from "react-native";

/**
 * Visual tokens mirrored from the web app. Do not invent values here.
 *
 * Standard dark + light:
 *   src/app/globals.css `:root` and `:root[data-theme="light"]`
 *   and the "2026 visual system" block (around the `.app-shell` reset).
 * Future / Retro (the settings label is "Future", the attribute is retro):
 *   src/app/retro.css `:root[data-appearance="retro"]` and accent presets.
 * Type stacks:
 *   --font-interface, --font-record, --font-serif in globals.css.
 *   JetBrains Mono files: public/fonts/JetBrainsMono-latin.woff2 and
 *   JetBrainsMono-latin-ext.woff2. mobile/assets/fonts/*.ttf are static
 *   instances of those two subsets (iOS expo-font cannot load the woff2
 *   variable fonts). License: mobile/assets/fonts/OFL.txt.
 */

export type ColorScheme = "dark" | "light";
export type AppearanceId = "standard" | "retro";
export type AccentId =
  | "orange"
  | "green"
  | "amber"
  | "blue"
  | "pink"
  | "violet";

export const accentIds: readonly AccentId[] = [
  "orange",
  "green",
  "amber",
  "blue",
  "pink",
  "violet",
];

/** src/app/retro.css accent custom properties. */
export const retroAccentHex: Record<AccentId, string> = {
  orange: "#e8743b",
  green: "#8cc26a",
  amber: "#e0a93f",
  blue: "#5eb4de",
  pink: "#f09ab8",
  violet: "#c4b0f5",
};

export type ThemeColors = Readonly<{
  scheme: ColorScheme;
  appearance: AppearanceId;
  /** --paper / --grid-surface */
  paper: string;
  gridSurface: string;
  ink: string;
  muted: string;
  /** Retro --text-faint. Standard falls back to --muted. */
  faint: string;
  hairline: string;
  line: string;
  /** --cream */
  cream: string;
  /** --surface-raised */
  surface: string;
  action: string;
  actionInk: string;
  clay: string;
  ochre: string;
  slate: string;
  moss: string;
  /** --journal-grid-line */
  gridLine: string;
  /** --nav-pill-fill */
  navFill: string;
  /** Date chip ink. Dark standard hard-codes #bdc6c0 in globals.css. */
  dateInk: string;
  /** .auth-error / .connected-moment-menu button:last-child */
  danger: string;
  /** color-mix(action 14%, cream) — --selection-fill in standard. */
  selectionFill: string;
  /** Retro nav is a flat mix; standard blur is 14px and not available here. */
  navBlur: number;
}>;

function mix(base: string, tint: string, tintShare: number) {
  const parse = (hex: string) => {
    const value = hex.replace("#", "");
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ];
  };
  const [br, bg, bb] = parse(base);
  const [tr, tg, tb] = parse(tint);
  const channel = (from: number, to: number) =>
    Math.round(from + (to - from) * tintShare)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(br, tr)}${channel(bg, tg)}${channel(bb, tb)}`;
}

const standardDark: Omit<ThemeColors, "scheme" | "appearance"> = {
  paper: "#101216",
  gridSurface: "#101216",
  ink: "#edf0f5",
  muted: "#a1abba",
  faint: "#a1abba",
  hairline: "rgba(176, 190, 210, 0.2)",
  line: "#343c49",
  cream: "#1b2028",
  surface: "#242b35",
  action: "#79adff",
  actionInk: "#101216",
  clay: "#c77c80",
  ochre: "#c59a56",
  slate: "#8b98ad",
  moss: "#82a472",
  gridLine: "rgba(139, 160, 190, 0.085)",
  navFill: "rgba(27, 32, 40, 0.88)",
  dateInk: "#bdc6c0",
  danger: "#e09292",
  selectionFill: mix("#1b2028", "#79adff", 0.14),
  navBlur: 14,
};

const standardLight: Omit<ThemeColors, "scheme" | "appearance"> = {
  paper: "#edf0f4",
  gridSurface: "#edf0f4",
  ink: "#1b2431",
  muted: "#596678",
  faint: "#596678",
  hairline: "rgba(56, 73, 98, 0.18)",
  line: "#c8d1de",
  cream: "#ffffff",
  surface: "#f2f5f9",
  action: "#2764be",
  actionInk: "#ffffff",
  clay: "#a8525c",
  ochre: "#9b6d24",
  slate: "#59677d",
  moss: "#58764e",
  gridLine: "rgba(74, 96, 128, 0.075)",
  navFill: "rgba(255, 255, 255, 0.88)",
  dateInk: "#596678",
  danger: "#8b3e36",
  selectionFill: mix("#ffffff", "#2764be", 0.14),
  navBlur: 14,
};

export function themeColors(
  appearance: AppearanceId,
  scheme: ColorScheme,
  accent: AccentId,
): ThemeColors {
  if (appearance === "retro") {
    const action = retroAccentHex[accent];
    return {
      scheme: "dark",
      appearance,
      paper: "#14110f",
      gridSurface: "#14110f",
      ink: "#ece3d8",
      muted: "#a39688",
      faint: "#6f655b",
      hairline: "#2a2420",
      line: "#2a2420",
      cream: "#1b1714",
      surface: "#221c18",
      action,
      actionInk: "#14110f",
      clay: "#e0604f",
      ochre: action,
      slate: "#a39688",
      moss: "#8cc26a",
      gridLine: "transparent",
      navFill: "rgba(27, 23, 20, 0.94)",
      dateInk: "#a39688",
      danger: "#e09292",
      selectionFill: "rgba(232, 116, 59, 0.14)",
      navBlur: 0,
    };
  }
  const palette = scheme === "light" ? standardLight : standardDark;
  return { ...palette, scheme, appearance };
}

/**
 * Fixed profile dots from globals.css `.dot-*`.
 * teal/clay/ochre/slate/moss follow the theme variables.
 */
export function dotColor(token: string, colors: ThemeColors) {
  switch (token) {
    case "teal":
      return colors.action;
    case "clay":
      return colors.clay;
    case "ochre":
      return colors.ochre;
    case "slate":
      return colors.slate;
    case "moss":
      return colors.moss;
    case "turquoise":
      return "#147d83";
    case "violet":
      return "#7855b5";
    case "cyan":
      return "#087ba1";
    case "emerald":
      return "#287952";
    case "lime":
      return "#577522";
    case "coral":
      return "#ba504e";
    case "orange":
      return "#b45b20";
    case "indigo":
      return "#5356a6";
    default:
      return colors.slate;
  }
}

/** `[class].dot-teal` ink is #101216 in dark; light theme uses white. */
export function dotInk(token: string, colors: ThemeColors) {
  const variable = ["teal", "clay", "ochre", "slate", "moss"].includes(token);
  if (variable && colors.scheme === "dark" && colors.appearance !== "retro") {
    return "#101216";
  }
  if (variable && colors.appearance === "retro") return "#14110f";
  if (variable && colors.scheme === "light") return "#ffffff";
  return "#ffffff";
}

/** globals.css --font-interface. System faces, not a bundled file. */
export const fontInterface = Platform.select({
  web: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  ios: "System",
  default: "sans-serif",
}) as string;

/** globals.css --font-record. */
export const fontRecord = Platform.select({
  web: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  ios: "Menlo",
  default: "monospace",
}) as string;

/** globals.css --font-serif. Scripture and thought cards. */
export const fontSerif = Platform.select({
  web: 'Georgia, "Times New Roman", serif',
  ios: "Georgia",
  default: "serif",
}) as string;

export const fontRetroRegular = "JetBrainsMono-Regular";
export const fontRetroSemibold = "JetBrainsMono-SemiBold";
export const fontRetroBold = "JetBrainsMono-Bold";

/** CSS em tracking → React Native density-independent pixels. */
export function tracking(fontSize: number, em: number) {
  return fontSize * em;
}

/**
 * Web uses 650 and 670. React Native's type only accepts 100-step weights.
 * On web we pass the CSS weight through so Expo web screenshots match.
 */
export function fontWeight(value: 400 | 500 | 600 | 650 | 670 | 700 | 750) {
  if (Platform.OS === "web") return String(value) as TextStyle["fontWeight"];
  if (value >= 680) return "700";
  if (value >= 630) return "600";
  if (value >= 550) return "600";
  if (value >= 450) return "500";
  return "400";
}

export function face(
  colors: ThemeColors,
  weight: 400 | 500 | 600 | 650 | 670 | 700 | 750,
  family: "interface" | "record" | "serif" = "interface",
): TextStyle {
  if (colors.appearance === "retro") {
    const retro =
      weight >= 680
        ? fontRetroBold
        : weight >= 550
          ? fontRetroSemibold
          : fontRetroRegular;
    return { fontFamily: retro, fontWeight: "400" };
  }
  const fontFamily =
    family === "record"
      ? fontRecord
      : family === "serif"
        ? fontSerif
        : fontInterface;
  return { fontFamily, fontWeight: fontWeight(weight) };
}

/** --journal-grid-size */
export const gridSize = 28;

/** --bottom-nav-float-gap / --bottom-nav-inline-gap */
export const floatGap = 10;
export const inlineGap = 12;

/** Floating header and bottom nav: globals.css `.topbar` / `.bottom-nav`. */
export const chromeHeight = 56;
export const chromeRadius = 18;

/**
 * phone-stage padding is 78 + float gap + safe area.
 * 78 = 56 bar + 12 leftover + 10, matching the web's content inset.
 */
export const stageChromeInset = 78 + floatGap;

/** .timeline padding from the 2026 block. */
export const timelineInset = 16;
export const timelineBottomPad = 76;

/** .moment margin-bottom */
export const momentGap = 30;

/** src/features/profile-color.ts profileColorAccent */
export function profileAccent(value: string | null | undefined) {
  switch (value) {
    case "sky":
      return "teal";
    case "gold":
      return "ochre";
    case "sage":
      return "moss";
    case "plum":
      return "clay";
    case "rose":
      return "ochre";
    case "turquoise":
    case "violet":
    case "clay":
    case "slate":
    case "cyan":
    case "emerald":
    case "lime":
    case "coral":
    case "orange":
    case "indigo":
      return value;
    default:
      return "slate";
  }
}
