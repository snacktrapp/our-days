import { replaceNonceableStyleSheet } from "@/lib/page-csp-nonce";

const insetVariable = "--bottom-nav-visual-inset";
const insetSheetId = "bottom-nav-visual-inset-sheet";

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
  replaceNonceableStyleSheet(
    view.document,
    insetSheetId,
    `:root{${insetVariable}:0px}`,
  );
}

export function clearBottomNavVisualInset(root: HTMLElement) {
  root.ownerDocument.getElementById(insetSheetId)?.remove();
}
