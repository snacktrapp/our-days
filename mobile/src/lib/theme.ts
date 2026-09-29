import { Platform, type TextStyle } from "react-native";

/**
 * Dark journal tokens from src/app/globals.css.
 * Recorded data uses the web --font-record stack. iOS apps cannot select
 * the CSS font stack, so dates, counts, and circle chips use Menlo, the
 * iOS face that stack falls back to after SF Mono.
 */
export const colors = {
  paper: "#101216",
  ink: "#edf0f5",
  muted: "#a1abba",
  hairline: "rgba(176, 190, 210, 0.2)",
  line: "#343c49",
  cream: "#1b2028",
  surface: "#242b35",
  action: "#79adff",
  actionInk: "#101216",
  danger: "#ff9b8f",
} as const;

export const recordFont: TextStyle["fontFamily"] = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

export const record: TextStyle = {
  fontFamily: recordFont,
  color: colors.muted,
};
