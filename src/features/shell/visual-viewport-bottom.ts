export const visualViewportOffsetTopVar = "--vv-offset-top";
export const visualViewportBottomInsetVar = "--vv-bottom-inset";

/** Shrinks smaller than this are Safari chrome / jitter, not a keyboard. */
export const keyboardLikeVisualViewportMinShrinkPx = 140;

const chromeInsetFreezePullStates = new Set([
  "pulling",
  "armed",
  "refreshing",
  "settling",
]);

export function visualViewportOffsetTop(
  view: Pick<Window, "visualViewport"> = window,
) {
  const viewport = view.visualViewport;
  if (!viewport) return 0;
  // Rubber-band overscroll reports a negative offsetTop. iOS already keeps
  // position:fixed chrome in the visual viewport then.
  return Math.max(0, viewport.offsetTop);
}

export function visualViewportBottomInset(
  view: Pick<Window, "innerHeight" | "visualViewport"> = window,
) {
  const viewport = view.visualViewport;
  if (!viewport) return 0;
  // A negative offsetTop is pull-down overscroll, not a gap below the
  // visual viewport. Using it in the leftover-gap math lifts `.bottom-nav`.
  if (viewport.offsetTop < 0) return 0;
  return Math.max(0, view.innerHeight - viewport.height - viewport.offsetTop);
}

export function pinVisualViewportBottomInset(
  view: Pick<Window, "innerHeight" | "visualViewport"> = window,
) {
  const inset = visualViewportBottomInset(view);
  return inset >= keyboardLikeVisualViewportMinShrinkPx ? inset : 0;
}

export function timelinePullFreezesChromeInset(doc: Document) {
  return [...doc.querySelectorAll(".timeline-pull-shell")].some((shell) =>
    chromeInsetFreezePullStates.has(
      shell.getAttribute("data-pull-state") ?? "",
    ),
  );
}

function writeViewportVar(root: HTMLElement, name: string, value: number) {
  root.style.setProperty(name, `${value}px`);
}

export function syncBottomNavVisualInset(
  view: Pick<Window, "innerHeight" | "visualViewport"> & {
    document: Document;
  } = window,
) {
  const root = view.document.documentElement;
  if (timelinePullFreezesChromeInset(view.document)) {
    writeViewportVar(root, visualViewportOffsetTopVar, 0);
    writeViewportVar(root, visualViewportBottomInsetVar, 0);
    return;
  }
  writeViewportVar(
    root,
    visualViewportOffsetTopVar,
    visualViewportOffsetTop(view),
  );
  writeViewportVar(
    root,
    visualViewportBottomInsetVar,
    pinVisualViewportBottomInset(view),
  );
}

export function clearBottomNavVisualInset(root: HTMLElement) {
  writeViewportVar(root, visualViewportOffsetTopVar, 0);
  writeViewportVar(root, visualViewportBottomInsetVar, 0);
}
