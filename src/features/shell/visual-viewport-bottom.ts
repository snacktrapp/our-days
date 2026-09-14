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

const overlayFreezeSelector = ".photo-lightbox";

type VisualViewportView = Pick<Window, "innerHeight" | "visualViewport"> & {
  innerWidth?: number;
};

export function visualViewportOffsetTop(
  view: Pick<Window, "visualViewport"> = window,
) {
  const viewport = view.visualViewport;
  if (!viewport) return 0;
  // Rubber-band overscroll reports a negative offsetTop. iOS already keeps
  // position:fixed chrome in the visual viewport then.
  return Math.max(0, viewport.offsetTop);
}

export function visualViewportBottomInset(view: VisualViewportView = window) {
  const viewport = view.visualViewport;
  if (!viewport) return 0;
  // A negative offsetTop is pull-down overscroll, not a gap below the
  // visual viewport. Using it in the leftover-gap math lifts `.bottom-nav`.
  if (viewport.offsetTop < 0) return 0;
  return Math.max(0, view.innerHeight - viewport.height - viewport.offsetTop);
}

export function visualViewportOrientationMatchesLayout(
  view: VisualViewportView = window,
) {
  const viewport = view.visualViewport;
  if (!viewport) return true;
  const visualWidth = viewport.width;
  const layoutWidth = view.innerWidth;
  if (visualWidth == null || layoutWidth == null) return true;
  const layoutPortrait = view.innerHeight >= layoutWidth;
  const visualPortrait = viewport.height >= visualWidth;
  return layoutPortrait === visualPortrait;
}

export function pinVisualViewportBottomInset(
  view: VisualViewportView = window,
) {
  // After a landscape lightbox, Safari can leave visualViewport at the
  // previous orientation while innerHeight already flipped. That leftover
  // looks keyboard-sized and pins the tab bar mid-screen.
  if (!visualViewportOrientationMatchesLayout(view)) return 0;
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

export function overlayFreezesChromeInset(doc: Document) {
  return (
    doc.documentElement.classList.contains("overlay-open") ||
    doc.body.classList.contains("overlay-open") ||
    Boolean(doc.querySelector(overlayFreezeSelector))
  );
}

function writeViewportVar(root: HTMLElement, name: string, value: number) {
  root.style.setProperty(name, `${value}px`);
}

export function syncBottomNavVisualInset(
  view: VisualViewportView & {
    document: Document;
  } = window,
) {
  const root = view.document.documentElement;
  if (
    timelinePullFreezesChromeInset(view.document) ||
    overlayFreezesChromeInset(view.document)
  ) {
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

export function restoreBottomNavAfterOverlay(
  view: VisualViewportView & {
    document: Document;
    requestAnimationFrame: Window["requestAnimationFrame"];
  } = window,
) {
  clearBottomNavVisualInset(view.document.documentElement);
  const sync = () => syncBottomNavVisualInset(view);
  sync();
  view.requestAnimationFrame(() => {
    sync();
    view.requestAnimationFrame(sync);
  });
}
