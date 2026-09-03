export const pageCspNonceMetaName = "csp-nonce";

export function pageCspNonce(doc: Document) {
  const meta = doc.querySelector(`meta[name="${pageCspNonceMetaName}"]`);
  const fromMeta = meta?.getAttribute("content")?.trim() ?? "";
  if (fromMeta) return fromMeta;
  for (const node of doc.querySelectorAll("script, style")) {
    if (!(node instanceof HTMLElement)) continue;
    const nonce = node.nonce || node.getAttribute("nonce") || "";
    if (nonce) return nonce;
  }
  return "";
}

export function replaceNonceableStyleSheet(
  doc: Document,
  id: string,
  cssText: string,
) {
  const sheet = doc.createElement("style");
  sheet.id = id;
  sheet.textContent = cssText;
  const nonce = pageCspNonce(doc);
  if (nonce) {
    sheet.setAttribute("nonce", nonce);
    sheet.nonce = nonce;
  }
  doc.getElementById(id)?.remove();
  doc.head.append(sheet);
  return sheet;
}
