import { StyleSheet } from "react-native";
import Svg, { Defs, Pattern, Path, Rect } from "react-native-svg";

import { gridSize } from "../lib/tokens";

/** globals.css --journal-grid-image, painted by `.app-shell::before`. */
export function GridBackground({ color }: Readonly<{ color: string }>) {
  if (color === "transparent") return null;
  return (
    <Svg
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
    >
      <Defs>
        <Pattern
          id="journal-grid"
          width={gridSize}
          height={gridSize}
          patternUnits="userSpaceOnUse"
        >
          <Path
            d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
            stroke={color}
            strokeWidth={1}
            fill="none"
          />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#journal-grid)" />
    </Svg>
  );
}
