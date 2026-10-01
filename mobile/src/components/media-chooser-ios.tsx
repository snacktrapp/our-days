import { useState, type ReactNode } from "react";
import { MenuView } from "@expo/ui/community/menu";
import {
  View,
  useWindowDimensions,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { mediaMenuItems, mediaSourceForMenuId, type MediaSource } from "../lib/pick-media";

function restingStyle(style: PressableProps["style"]): StyleProp<ViewStyle> {
  return typeof style === "function" ? style({ pressed: false }) : style;
}

/** iOS pull-down menu (SwiftUI Menu, backed by UIMenu) anchored to the tile. */
export function IosMediaMenu({
  accessibilityLabel,
  onPick,
  style,
  children,
}: Readonly<{
  accessibilityLabel: string;
  onPick: (source: MediaSource) => void;
  style?: PressableProps["style"];
  children: ReactNode;
}>) {
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(windowWidth - 40);
  return (
    <View
      style={styles.anchor}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next > 0 && next !== measuredWidth) setMeasuredWidth(next);
      }}
    >
      <MenuView
        actions={mediaMenuItems.map((item) => ({
          id: item.id,
          title: item.title,
          image: item.symbol,
        }))}
        onPressAction={(event) => {
          const source = mediaSourceForMenuId(event.nativeEvent.event);
          if (source) onPick(source);
        }}
        style={styles.anchor}
      >
        <View
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={[restingStyle(style), { width: measuredWidth }]}
        >
          {children}
        </View>
      </MenuView>
    </View>
  );
}

const styles = {
  anchor: { alignSelf: "stretch" as const, width: "100%" as const },
};
