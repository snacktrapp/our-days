const overlayThemeColor = "#000000";
const overlayMetaFlag = "overlayChrome";

let lockCount = 0;

function themeColorMetas() {
  return [
    ...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
  ];
}

function applyBlackThemeColor() {
  for (const meta of themeColorMetas()) {
    if (meta.dataset[overlayMetaFlag] == null) {
      meta.dataset[overlayMetaFlag] = meta.getAttribute("content") ?? "";
    }
    meta.setAttribute("content", overlayThemeColor);
  }
}

function restoreThemeColor() {
  for (const meta of themeColorMetas()) {
    const previous = meta.dataset[overlayMetaFlag];
    if (previous == null) continue;
    meta.setAttribute("content", previous);
    delete meta.dataset[overlayMetaFlag];
  }
}

/** Safari paints theme-color in the home-indicator / toolbar gap. */
export function lockOverlayChrome() {
  if (typeof document === "undefined") return;
  lockCount += 1;
  if (lockCount === 1) applyBlackThemeColor();
}

export function unlockOverlayChrome() {
  if (typeof document === "undefined") return;
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) restoreThemeColor();
}

export function resetOverlayChromeForTests() {
  lockCount = 0;
  restoreThemeColor();
}
