"use client";

import { useLayoutEffect, useState } from "react";

export const inlineNotePanelChangeEvent = "our-days:inline-note-panel";

export function documentHidesBottomNav(root: ParentNode = document) {
  return Boolean(root.querySelector(".inline-note-form"));
}

export function notifyInlineNotePanelChanged() {
  window.dispatchEvent(new Event(inlineNotePanelChangeEvent));
}

export function useHideBottomNavWhileComposing(composerOpen = false) {
  const [noteOpen, setNoteOpen] = useState(false);

  useLayoutEffect(() => {
    const sync = () => setNoteOpen(documentHidesBottomNav());
    sync();
    window.addEventListener(inlineNotePanelChangeEvent, sync);
    return () => window.removeEventListener(inlineNotePanelChangeEvent, sync);
  }, []);

  return composerOpen || noteOpen;
}
