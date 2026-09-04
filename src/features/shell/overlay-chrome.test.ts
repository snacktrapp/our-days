import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  lockOverlayChrome,
  resetOverlayChromeForTests,
  unlockOverlayChrome,
} from "./overlay-chrome";

function themeMeta() {
  return document.querySelector('meta[name="theme-color"]');
}

describe("overlay chrome", () => {
  beforeEach(() => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#0b1712");
    document.head.append(meta);
  });

  afterEach(() => {
    resetOverlayChromeForTests();
    themeMeta()?.remove();
  });

  it("paints Safari theme-color black while an overlay is open", () => {
    lockOverlayChrome();
    expect(themeMeta()?.getAttribute("content")).toBe("#000000");
    unlockOverlayChrome();
    expect(themeMeta()?.getAttribute("content")).toBe("#0b1712");
  });

  it("keeps the chrome black until the last overlay unlocks", () => {
    lockOverlayChrome();
    lockOverlayChrome();
    expect(themeMeta()?.getAttribute("content")).toBe("#000000");
    unlockOverlayChrome();
    expect(themeMeta()?.getAttribute("content")).toBe("#000000");
    unlockOverlayChrome();
    expect(themeMeta()?.getAttribute("content")).toBe("#0b1712");
  });
});
