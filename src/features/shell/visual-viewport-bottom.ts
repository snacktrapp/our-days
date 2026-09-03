const insetVariable = "--bottom-nav-visual-inset";
const insetSheetId = "bottom-nav-visual-inset-sheet";

export function visualViewportBottomInset(
  view: Pick<Window, "innerHeight" | "visualViewport"> = window,
) {
  const viewport = view.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, view.innerHeight - viewport.height - viewport.offsetTop);
}

function pageNonce(doc: Document) {
  const withNonce = doc.querySelector<HTMLElement>("[nonce]");
  return withNonce?.nonce || withNonce?.getAttribute("nonce") || "";
}

function insetSheet(doc: Document) {
  const existing = doc.getElementById(insetSheetId);
  if (existing instanceof HTMLStyleElement) return existing;
  const sheet = doc.createElement("style");
  sheet.id = insetSheetId;
  const nonce = pageNonce(doc);
  if (nonce) sheet.setAttribute("nonce", nonce);
  doc.head.append(sheet);
  return sheet;
}

export function syncBottomNavVisualInset(
  view: Pick<Window, "innerHeight" | "visualViewport"> & {
    document: Document;
  } = window,
) {
  insetSheet(view.document).textContent =
    `:root{${insetVariable}:${visualViewportBottomInset(view)}px}`;
}

export function clearBottomNavVisualInset(root: HTMLElement) {
  root.ownerDocument.getElementById(insetSheetId)?.remove();
}
