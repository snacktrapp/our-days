export const visualViewportOffsetTopVar = "--vv-offset-top";
export const visualViewportBottomInsetVar = "--vv-bottom-inset";

export function visualViewportOffsetTop(
  view: Pick<Window, "visualViewport"> = window,
) {
  const viewport = view.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, viewport.offsetTop);
}

export function visualViewportBottomInset(
  view: Pick<Window, "innerHeight" | "visualViewport"> = window,
) {
  const viewport = view.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, view.innerHeight - viewport.height - viewport.offsetTop);
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
  writeViewportVar(
    root,
    visualViewportOffsetTopVar,
    visualViewportOffsetTop(view),
  );
  writeViewportVar(
    root,
    visualViewportBottomInsetVar,
    visualViewportBottomInset(view),
  );
}

export function clearBottomNavVisualInset(root: HTMLElement) {
  writeViewportVar(root, visualViewportOffsetTopVar, 0);
  writeViewportVar(root, visualViewportBottomInsetVar, 0);
}
