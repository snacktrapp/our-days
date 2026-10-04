import { requireOptionalNativeModule } from "expo";
import { type ComponentType, type ReactNode } from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  type PressableProps,
} from "react-native";

import {
  mediaMenuItems,
  mediaMenuOptions,
  mediaSourceForMenuIndex,
  usesNativeMediaMenu,
  type MediaSource,
} from "../lib/pick-media";

type ChooserProps = Readonly<{
  accessibilityLabel: string;
  onPick: (source: MediaSource) => void;
  style?: PressableProps["style"];
  children: ReactNode;
}>;

function expoUiPresent() {
  try {
    return requireOptionalNativeModule("ExpoUI") != null;
  } catch {
    return false;
  }
}

/**
 * The menu component imports @expo/ui, whose module init calls into ExpoUI.
 * A static import would crash an over-the-air update on runtime 0.5.0, which
 * does not contain that native module. Require it only after the probe.
 */
function loadIosMediaMenu(): ComponentType<ChooserProps> | null {
  if (!usesNativeMediaMenu(Platform.OS, expoUiPresent())) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("./media-chooser-ios") as typeof import("./media-chooser-ios")).IosMediaMenu;
}

const IosMediaMenu = loadIosMediaMenu();

function presentFallbackMenu(onPick: (source: MediaSource) => void) {
  if (Platform.OS === "web") {
    onPick("files");
    return;
  }
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...mediaMenuOptions, "Cancel"],
        cancelButtonIndex: mediaMenuOptions.length,
      },
      (index) => {
        const source = mediaSourceForMenuIndex(index);
        if (source) onPick(source);
      },
    );
    return;
  }
  Alert.alert("Choose photo or video", undefined, [
    ...mediaMenuItems.map((item) => ({
      text: item.title,
      onPress: () => onPick(item.id),
    })),
    { text: "Cancel", style: "cancel" },
  ]);
}

/**
 * Photo Library, camera, and files. On iOS with ExpoUI this is a pull-down
 * menu anchored to the trigger. Otherwise it is the action sheet (or the
 * file picker on web).
 */
export function MediaChooser({ accessibilityLabel, onPick, style, children }: ChooserProps) {
  if (IosMediaMenu) {
    return (
      <IosMediaMenu accessibilityLabel={accessibilityLabel} onPick={onPick} style={style}>
        {children}
      </IosMediaMenu>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => presentFallbackMenu(onPick)}
      style={style}
    >
      {children}
    </Pressable>
  );
}
