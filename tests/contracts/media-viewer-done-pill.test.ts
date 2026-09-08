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

describe("media viewer Done pill CSS contract", () => {
  it("uses the cream pill on dark and light media chrome", () => {
    const close = ruleBody(".photo-lightbox-close.media-viewer-close");
    const light = ruleBody(
      ':root[data-theme="light"] .photo-lightbox-close.media-viewer-close',
    );

    expect(close).toMatch(/min-height:\s*44px;/);
    expect(close).toMatch(/color:\s*#161410;/);
    expect(close).toMatch(/background:\s*rgba\(255,\s*250,\s*240,\s*0\.88\);/);
    expect(close).not.toMatch(/background:\s*rgba\(8,\s*10,\s*9/);
    expect(light).toMatch(/color:\s*#161410;/);
    expect(light).toMatch(/background:\s*rgba\(255,\s*250,\s*240,\s*0\.88\);/);
  });
});
