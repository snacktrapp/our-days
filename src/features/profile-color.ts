import type { AccentToken } from "./accent-token";

export const profileColors = [
  { token: "sky", accent: "teal", name: "Blue" },
  { token: "turquoise", accent: "turquoise", name: "Teal" },
  { token: "violet", accent: "violet", name: "Purple" },
  { token: "clay", accent: "clay", name: "Rose" },
  { token: "gold", accent: "ochre", name: "Amber" },
  { token: "slate", accent: "slate", name: "Slate" },
  { token: "cyan", accent: "cyan", name: "Cyan" },
  { token: "emerald", accent: "emerald", name: "Emerald" },
  { token: "lime", accent: "lime", name: "Lime" },
  { token: "coral", accent: "coral", name: "Coral" },
  { token: "orange", accent: "orange", name: "Orange" },
  { token: "indigo", accent: "indigo", name: "Indigo" },
] as const satisfies readonly {
  token: string;
  accent: AccentToken;
  name: string;
}[];

export type ProfileColorToken = (typeof profileColors)[number]["token"];
// Retain older stored values and exported journals without recoloring them.
export const storedProfileColors = [
  "clay",
  "sage",
  "gold",
  "sky",
  "plum",
  "rose",
  "slate",
  "turquoise",
  "violet",
  "cyan",
  "emerald",
  "lime",
  "coral",
  "orange",
  "indigo",
] as const;
export type StoredProfileColor = (typeof storedProfileColors)[number];

export function isProfileColor(value: unknown): value is ProfileColorToken {
  return profileColors.some((color) => color.token === value);
}

export function profileColorAccent(value: string): AccentToken {
  const color = profileColors.find((item) => item.token === value);
  if (color) return color.accent;
  if (value === "sage") return "moss";
  if (value === "plum") return "clay";
  if (value === "rose") return "ochre";
  return "slate";
}
