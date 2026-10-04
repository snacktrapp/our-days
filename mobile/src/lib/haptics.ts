import { Platform } from "react-native";

type HapticsModule = typeof import("expo-haptics");
let loaded: Promise<HapticsModule | null> | null = null;

/**
 * expo-haptics is native code new in build 19. Loading it lazily and
 * swallowing failures keeps this JS safe on a binary without it and on web.
 */
function haptics() {
  if (Platform.OS !== "ios") return Promise.resolve(null);
  loaded ??= import("expo-haptics").catch(() => null);
  return loaded;
}

/** Light tap: a photo thumb is picked up. */
export function liftHaptic() {
  void haptics()
    .then((module) => module?.impactAsync(module.ImpactFeedbackStyle.Light))
    .catch(() => undefined);
}

/** Selection tick: the dragged thumb moved to another slot. */
export function slotHaptic() {
  void haptics()
    .then((module) => module?.selectionAsync())
    .catch(() => undefined);
}
