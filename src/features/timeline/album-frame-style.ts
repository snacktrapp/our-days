import { pageCspNonce } from "@/lib/page-csp-nonce";

export const albumFrameStyleId = "our-days-album-frame-css";

const heights = new Map<string, string>();

function escapeAttr(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderAlbumFrameSheet(doc: Document) {
  let sheet = doc.getElementById(albumFrameStyleId);
  if (!(sheet instanceof HTMLStyleElement)) {
    if (heights.size === 0) return;
    sheet = doc.createElement("style");
    sheet.id = albumFrameStyleId;
    const nonce = pageCspNonce(doc);
    if (nonce) {
      sheet.setAttribute("nonce", nonce);
      sheet.nonce = nonce;
    }
    doc.head.append(sheet);
  }
  sheet.textContent =
    heights.size === 0
      ? ""
      : [...heights.entries()]
          .map(
            ([key, px]) =>
              `.photo-card-pager[data-album="${escapeAttr(key)}"]{--album-frame-height:${px}}`,
          )
          .join("");
}

/**
 * Album frame height cannot live in a style attribute: production CSP sets
 * style-src-attr 'none'. A nonce-backed sheet is the same path as other
 * dynamic custom properties.
 */
export function setAlbumFrameHeight(
  doc: Document,
  key: string,
  heightPx: number,
) {
  if (!key || heightPx <= 0 || !Number.isFinite(heightPx)) return;
  const px = `${Math.round(heightPx * 100) / 100}px`;
  if (heights.get(key) === px) return;
  heights.set(key, px);
  renderAlbumFrameSheet(doc);
}

export function clearAlbumFrameHeight(doc: Document, key: string) {
  if (!heights.delete(key)) return;
  renderAlbumFrameSheet(doc);
}
