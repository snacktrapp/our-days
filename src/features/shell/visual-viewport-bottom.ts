export function visualViewportBottomInset(
  view: Pick<Window, "innerHeight" | "visualViewport"> = window,
) {
  const viewport = view.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, view.innerHeight - viewport.height - viewport.offsetTop);
}

export function syncBottomNavVisualInset(
  view: Pick<Window, "innerHeight" | "visualViewport"> & {
    document: Document;
  } = window,
) {
  void view;
  // iOS already pins position:fixed to the visual viewport. Applying the
  // leftover layout gap as `bottom` lifts the bar and leaves a beige hole
  // above the home indicator. globals.css already keeps the inset at 0px,
  // so this must not write a stylesheet (production style-src blocks it).
}

export function clearBottomNavVisualInset(root: HTMLElement) {
  void root;
}
