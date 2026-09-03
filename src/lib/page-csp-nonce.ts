export const pageCspNonceMetaName = "csp-nonce";
export const dynamicCssStyleId = "our-days-dynamic-css";

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

function readCssVars(sheet: HTMLStyleElement) {
  const vars = new Map<string, string>();
  for (const match of (sheet.textContent ?? "").matchAll(
    /(--[\w-]+):([^;}]+)/g,
  )) {
    vars.set(match[1], match[2].trim());
  }
  return vars;
}

function writeCssVars(sheet: HTMLStyleElement, vars: Map<string, string>) {
  if (vars.size === 0) {
    sheet.textContent = "";
    return;
  }
  sheet.textContent = `:root{${[...vars]
    .map(([name, value]) => `${name}:${value}`)
    .join(";")}}`;
}

function dynamicStyleElement(doc: Document) {
  const existing = doc.getElementById(dynamicCssStyleId);
  if (existing instanceof HTMLStyleElement) return existing;
  const sheet = doc.createElement("style");
  sheet.id = dynamicCssStyleId;
  const nonce = pageCspNonce(doc);
  if (nonce) {
    sheet.setAttribute("nonce", nonce);
    sheet.nonce = nonce;
  }
  doc.head.append(sheet);
  return sheet;
}

export function setDynamicCssVar(doc: Document, name: string, value: string) {
  const sheet = dynamicStyleElement(doc);
  const vars = readCssVars(sheet);
  vars.set(name, value);
  writeCssVars(sheet, vars);
  return sheet;
}

export function deleteDynamicCssVar(doc: Document, name: string) {
  const existing = doc.getElementById(dynamicCssStyleId);
  if (!(existing instanceof HTMLStyleElement)) return;
  const vars = readCssVars(existing);
  vars.delete(name);
  writeCssVars(existing, vars);
}
