/**
 * Profile color → avatar accent. Same map as src/features/profile-color.ts
 * profileColorAccent. Kept free of react-native so Node (the sign-in e2e)
 * can load the journal loader.
 */
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
