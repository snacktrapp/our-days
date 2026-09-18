"use client";

import { useSyncExternalStore } from "react";

const key = "our-days:primary-feed";
const event = "our-days:primary-feed-change";
let fallback = false;

function read() {
  try {
    return sessionStorage.getItem(key) === "you";
  } catch {
    return fallback;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(event, onChange);
  return () => window.removeEventListener(event, onChange);
}

function rememberJournal(href: string) {
  fallback = href.startsWith("/people/");
  // Store only the selected mode, never a person's identity or journal data.
  // This survives route remounts and resolves to the signed-in user's own ID.
  try {
    sessionStorage.setItem(key, fallback ? "you" : "all");
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  window.dispatchEvent(new Event(event));
}

// The loading shell has no person ID. Resolve the signed-in person's journal
// on the server instead of silently substituting All circles during a handoff.
export function resolveJournalHref(justMeHref?: string) {
  return read() ? (justMeHref ?? "/journal?view=you") : "/family";
}

export function useJournalNavigationMemory() {
  const preferJustMe = useSyncExternalStore(subscribe, read, () => false);
  return { preferJustMe, rememberJournal };
}
