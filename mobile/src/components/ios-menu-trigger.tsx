import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export type MenuItem = Readonly<{ id: string; title: string; destructive?: boolean; onPress: () => void }>;

/** iOS only (see ios-menu-trigger.ios.tsx); other platforms use a Pressable. */
export function IosMenuTrigger(
  _props: Readonly<{ items: readonly MenuItem[]; style: StyleProp<ViewStyle>; children: ReactNode }>,
) {
  return null;
}
