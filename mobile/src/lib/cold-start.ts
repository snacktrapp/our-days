export type ColdStartSurface = "splash" | "feed" | "sign-in";

/**
 * Cold open stays on the splash until the session is known, then shows the
 * feed or sign-in in place. It does not navigate, so the stack cannot slide
 * the same screen in a second time.
 */
export function coldStartSurface(ready: boolean, signedIn: boolean): ColdStartSurface {
  if (!ready) return "splash";
  return signedIn ? "feed" : "sign-in";
}

/** How many times a launch sequence enters the feed. A cold open must be 1. */
export function feedMountsOnColdStart(
  states: readonly { ready: boolean; signedIn: boolean }[],
) {
  let mounts = 0;
  let previous: ColdStartSurface = "splash";
  for (const state of states) {
    const next = coldStartSurface(state.ready, state.signedIn);
    if (next === "feed" && previous !== "feed") mounts += 1;
    previous = next;
  }
  return mounts;
}

export function shouldReloadUpdate(
  input: Readonly<{
    dev: boolean;
    enabled: boolean;
    available: boolean;
    isNew: boolean;
    elapsedMs: number;
    windowMs: number;
    /** True once the splash has revealed the feed. A reload after that replays launch. */
    revealed: boolean;
  }>,
) {
  if (input.dev || !input.enabled) return false;
  if (!input.available || !input.isNew) return false;
  if (input.revealed) return false;
  return input.elapsedMs <= input.windowMs;
}
