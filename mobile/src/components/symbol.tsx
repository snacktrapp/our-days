import Ionicons from "@expo/vector-icons/Ionicons";

const ion: Record<string, keyof typeof Ionicons.glyphMap> = {
  "chevron.right": "chevron-forward",
  plus: "add",
  "person.badge.plus": "person-add",
};

/** Web and Android stand-in for the iOS SF Symbol of the same name. */
export function Symbol({
  name,
  size,
  color,
}: Readonly<{ name: keyof typeof ion; size: number; color: string }>) {
  return <Ionicons name={ion[name]} size={size} color={color} />;
}
