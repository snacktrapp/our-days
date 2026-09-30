import Svg, {
  Circle,
  Path,
  Rect,
} from "react-native-svg";

/**
 * Icon paths copied from the web components. Stroke defaults match
 * globals.css `.nav-symbol svg` (1.55) unless a component sets its own.
 */

type IconProps = Readonly<{
  color: string;
  size?: number;
}>;

export function NavFamily({ color, size = 21 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 11.2v1.6" stroke={color} strokeWidth={1.55} strokeLinecap="round" />
      <Rect
        x={5.5}
        y={5}
        width={13}
        height={5.2}
        rx={1.6}
        stroke={color}
        strokeWidth={1.55}
        fill="none"
      />
      <Rect
        x={5.5}
        y={13.8}
        width={13}
        height={5.2}
        rx={1.6}
        stroke={color}
        strokeWidth={1.55}
        fill="none"
      />
    </Svg>
  );
}

export function NavAdd({ color, size = 21 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 5v14M5 12h14"
        stroke={color}
        strokeWidth={1.55}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function NavCircles({ color, size = 21 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={8} r={3} stroke={color} strokeWidth={1.55} />
      <Path
        d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-4-5.65"
        stroke={color}
        strokeWidth={1.55}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** src/features/shell/settings-link.tsx */
export function SettingsGear({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 4V2h6v2l2 1 2-1 3 5-2 1v3l2 1-3 5-2-1-2 1v3H9v-3l-2-1-2 1-3-5 2-1v-3L2 9l3-5 2 1Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}

/** src/features/shell/notification-center.tsx trigger */
export function NotificationMark({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20.2 8.8c0 5.2-8.2 10-8.2 10s-8.2-4.8-8.2-10A4.3 4.3 0 0 1 12 6.9a4.3 4.3 0 0 1 8.2 1.9Z"
        stroke={color}
        strokeWidth={1.55}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** src/features/shell/theme-toggle.tsx */
export function SunIcon({ color, size = 19 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={3.75} stroke={color} strokeWidth={1.5} />
      <Path
        d="M12 2.75v2M12 19.25v2M2.75 12h2M19.25 12h2M5.46 5.46l1.42 1.42M17.12 17.12l1.42 1.42M18.54 5.46l-1.42 1.42M6.88 17.12l-1.42 1.42"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function MoonIcon({ color, size = 19 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19.4 15.1A7.8 7.8 0 0 1 8.9 4.6 7.8 7.8 0 1 0 19.4 15.1Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** src/features/shell/family-title-switcher.tsx chevron */
export function ChevronDown({ color, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="m4.5 6 3.5 3.5L11.5 6"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CheckIcon({ color, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="m3.5 8.2 3 3 6-6.4"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** src/features/timeline/heart-glyph.tsx */
export function HeartGlyph({
  color,
  size = 22,
  filled = false,
}: IconProps & Readonly<{ filled?: boolean }>) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20.5 9c0 5-8.5 11-8.5 11S3.5 14 3.5 9a4.75 4.75 0 0 1 8.5-2.9A4.75 4.75 0 0 1 20.5 9Z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Comment control in moment-conversation-control.tsx */
export function CommentIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5.5 4.25h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7L7 20v-2.75H5.5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 10h8M8 13h5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** src/features/timeline/place-pin.tsx */
export function PlacePin({ color, hole, size = 12 }: IconProps & Readonly<{ hole: string }>) {
  return (
    <Svg width={size} height={16} viewBox="0 0 16 22">
      <Path
        d="M8 0C3.8 0 .3 3.5.3 7.7c0 5.4 7.7 14.3 7.7 14.3s7.7-8.9 7.7-14.3C15.7 3.5 12.2 0 8 0z"
        fill={color}
      />
      <Circle cx={8} cy={7.6} r={3.1} fill={hole} />
    </Svg>
  );
}

/** Insight byline mark from timeline-feed.tsx */
export function InsightMark({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Path
        fill={color}
        fillRule="evenodd"
        d="M512 176a174 174 0 1 1 0 348 174 174 0 0 1 0-348Zm0 90a84 84 0 1 0 0 168 84 84 0 0 0 0-168Z"
      />
      <Path fill={color} d="M468 503h88v47h-88z" />
      <Path
        fill={color}
        fillRule="evenodd"
        d="M372 534h166a154 154 0 0 1 0 308H372q-20 0-20-20V554q0-20 20-20Zm74 78v152h86a76 76 0 0 0 0-152Z"
      />
    </Svg>
  );
}

/** journal-banner.tsx sparkle */
export function SparkleIcon({ color, size = 17 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M12 2.8 13.15 10.15 20.5 12 13.15 13.85 12 21.2 10.85 13.85 3.5 12 10.85 10.15Z"
      />
    </Svg>
  );
}

export function DismissIcon({ color, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 7l10 10M17 7 7 17"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}
