import { useEffect } from "react";
import { Platform } from "react-native";
import { useShareIntent } from "expo-share-intent";

import { draftFromShareIntent, type ShareDraft } from "../lib/share-entry";

let pending: ShareDraft | null = null;
let resetNative: (() => void) | null = null;
const listeners = new Set<(draft: ShareDraft | null) => void>();

function publish(draft: ShareDraft | null) {
  pending = draft;
  for (const listener of listeners) listener(draft);
}

export function currentShareDraft() {
  return pending;
}

export function subscribeShareDraft(listener: (draft: ShareDraft | null) => void) {
  listeners.add(listener);
  listener(pending);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissShareDraft() {
  publish(null);
  resetNative?.();
}

/** Mounted at the root so a share can arrive before the journal is signed in. */
export function ShareIntentBridge() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({
    disabled: Platform.OS === "web",
    scheme: "ourdays",
    resetOnBackground: false,
  });

  useEffect(() => {
    resetNative = () => resetShareIntent(true);
    return () => {
      resetNative = null;
    };
  }, [resetShareIntent]);

  useEffect(() => {
    if (!hasShareIntent) return;
    const draft = draftFromShareIntent(shareIntent);
    if (draft) publish(draft);
  }, [hasShareIntent, shareIntent]);

  return null;
}
