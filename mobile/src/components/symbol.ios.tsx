import { Host, Image } from "@expo/ui/swift-ui";
import type { SFSymbol } from "sf-symbols-typescript";

/** SF Symbol. The iOS binary (runtime 0.5.0, build 13) includes Expo UI. */
export function Symbol({
  name,
  size,
  color,
}: Readonly<{ name: SFSymbol; size: number; color: string }>) {
  return (
    <Host matchContents style={{ width: size, height: size }}>
      <Image systemName={name} size={size} color={color} />
    </Host>
  );
}
