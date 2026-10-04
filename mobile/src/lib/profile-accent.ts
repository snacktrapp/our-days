/**
 * Profile color → avatar accent. Same map as src/features/profile-color.ts.
 * Kept free of react-native so Node (the sign-in e2e) can load the journal loader.
 */
export const profileColorChoices = [
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
] as const;

export type ProfileColorToken = (typeof profileColorChoices)[number]["token"];

export function isProfileColorToken(value: string): value is ProfileColorToken {
  return profileColorChoices.some((item) => item.token === value);
}

export function profileColorName(value: string | null | undefined) {
  return (
    profileColorChoices.find((item) => item.token === value)?.name ??
    "Current color"
  );
}

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
