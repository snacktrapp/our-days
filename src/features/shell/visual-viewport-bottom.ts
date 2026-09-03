const insetVariable = "--bottom-nav-visual-inset";

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
  view.document.documentElement.style.setProperty(
    insetVariable,
    `${visualViewportBottomInset(view)}px`,
  );
}

export function clearBottomNavVisualInset(root: HTMLElement) {
  root.style.removeProperty(insetVariable);
}
