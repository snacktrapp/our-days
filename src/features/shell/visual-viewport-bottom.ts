import { deleteDynamicCssVar, setDynamicCssVar } from "@/lib/page-csp-nonce";

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
  // iOS already pins position:fixed to the visual viewport. Applying the
  // leftover layout gap as `bottom` lifts the bar and leaves a beige hole
  // above the home indicator.
  setDynamicCssVar(view.document, insetVariable, "0px");
}

export function clearBottomNavVisualInset(root: HTMLElement) {
  deleteDynamicCssVar(root.ownerDocument, insetVariable);
}
