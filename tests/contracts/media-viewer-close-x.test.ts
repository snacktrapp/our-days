import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function ruleBody(selector: string) {
  const needle = `${selector} {`;
  const start = css.indexOf(needle);
  expect(start, `missing rule ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const character = css[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(open + 1, index);
      }
    }
  }
  throw new Error(`unclosed rule ${selector}`);
}

describe("media viewer controls CSS contract", () => {
  it("keeps a translucent X for photos and no custom video dialog", () => {
    const close = ruleBody(".photo-lightbox-close.media-viewer-close");
    const light = ruleBody(
      ':root[data-theme="light"] .photo-lightbox-close.media-viewer-close',
    );
    const stage = ruleBody(".photo-lightbox-stage");
    const lightbox = ruleBody(".photo-lightbox");
    const nativeVideoTrigger = ruleBody(".native-video-trigger");

    expect(close).toMatch(/position:\s*absolute;/);
    expect(close).toMatch(/min-height:\s*44px;/);
    expect(close).toMatch(/min-width:\s*44px;/);
    expect(close).toMatch(/border-radius:\s*50%;/);
    expect(close).toMatch(/background:\s*rgba\(8,\s*10,\s*9,\s*0\.42\);/);
    expect(close).toMatch(/env\(safe-area-inset-top/);
    expect(close).toMatch(/env\(safe-area-inset-right/);
    expect(close).not.toMatch(/background:\s*rgba\(255,\s*250,\s*240/);
    expect(light).toMatch(/background:\s*rgba\(8,\s*10,\s*9,\s*0\.42\);/);
    expect(stage).toMatch(/env\(safe-area-inset-bottom, 0px\)/);
    expect(stage).not.toMatch(/max\(56px/);
    expect(nativeVideoTrigger).toMatch(/position:\s*absolute;/);
    expect(nativeVideoTrigger).toMatch(/inset:\s*0;/);
    expect(css).not.toMatch(/\.fullscreen-media-dialog/);
    expect(css).not.toMatch(/\.video-media-viewer-close/);
    expect(css).not.toMatch(/grid-row:\s*2;/);
    expect(lightbox).toMatch(/height:\s*100dvh;/);
    expect(lightbox).not.toMatch(/100lvh/);
    expect(css).not.toMatch(/\.media-viewer-chrome\s*\{/);
  });
});
