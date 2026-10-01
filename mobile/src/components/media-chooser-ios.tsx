import { useState, type ReactNode } from "react";
import { MenuView } from "@expo/ui/community/menu";
import {
  StyleSheet,
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

/**
 * iOS pull-down menu (SwiftUI Menu, backed by UIMenu) anchored to the tile.
 * The SwiftUI host does not pass its size to React children, so the trigger
 * gets explicit dimensions: a fixed tile keeps its own width and height, a
 * flex: 1 tile fills the measured parent, and anything else spans the row.
 */
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
  const resting = restingStyle(style);
  const flat = StyleSheet.flatten(resting) ?? {};
  const fixedWidth = typeof flat.width === "number" ? flat.width : null;
  const fixedHeight = typeof flat.height === "number" ? flat.height : null;
  const fills = flat.flex === 1 && fixedWidth === null;
  const [measured, setMeasured] = useState({ width: windowWidth - 40, height: 0 });
  const anchorStyle: ViewStyle =
    fixedWidth !== null
      ? { width: fixedWidth, height: fixedHeight ?? undefined }
      : fills
        ? styles.fill
        : styles.row;
  const triggerSize: ViewStyle =
    fixedWidth !== null
      ? { width: fixedWidth }
      : fills
        ? { width: measured.width, height: measured.height }
        : { width: measured.width };
  return (
    <View
      style={anchorStyle}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && (width !== measured.width || height !== measured.height)) {
          setMeasured({ width, height });
        }
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
        style={fixedWidth !== null || fills ? StyleSheet.absoluteFill : styles.row}
      >
        <View
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={[resting, triggerSize]}
        >
          {children}
        </View>
      </MenuView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignSelf: "stretch", width: "100%" },
  fill: { flex: 1, alignSelf: "stretch" },
});
