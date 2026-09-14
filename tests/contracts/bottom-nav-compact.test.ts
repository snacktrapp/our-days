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

describe("bottom-nav compact CSS contract", () => {
  it("keeps the layout box at 56px and scales the whole pill by 10%", () => {
    const nav = ruleBody(".bottom-nav");
    const compact = ruleBody(".bottom-nav.is-compact");

    expect(nav).toMatch(/height:\s*56px;/);
    expect(nav).toMatch(/display:\s*flex;/);
    expect(nav).not.toMatch(/repeat\(4/);
    expect(nav).toMatch(/transform-origin:\s*bottom center;/);
    expect(compact).toMatch(/transform:\s*scale\(0\.9\);/);
    expect(compact).not.toMatch(/height\s*:/);
    expect(compact).not.toMatch(/padding\s*:/);
    expect(css).not.toMatch(/\.bottom-nav\.is-compact\s+\.nav-item\s*\{/);
    expect(css).not.toMatch(/\.bottom-nav\.is-compact\s+\.nav-symbol\s*\{/);
  });

  it("hides the pill without lifting it when a note or composer is open", () => {
    const hidden = ruleBody(".bottom-nav.is-hidden");
    expect(hidden).toMatch(/visibility:\s*hidden;/);
    expect(hidden).toMatch(/pointer-events:\s*none;/);
    expect(hidden).not.toMatch(/transform:/);
    expect(css).toMatch(/:root:has\(\.inline-note-form\) \.bottom-nav/);
    expect(css).toMatch(
      /:root:has\(\.new-moment-composer-dialog\[open\]\) \.bottom-nav/,
    );
    expect(css).toMatch(/:root:has\(\.photo-lightbox\) \.bottom-nav/);
    expect(css).not.toMatch(/\.fullscreen-media-dialog/);
    expect(css).toMatch(/html\.overlay-open \.bottom-nav/);
  });

  it("animates only the pill scale in 180ms and snaps when motion is reduced", () => {
    expect(css).toMatch(
      /\.bottom-nav\s*\{\s*transition:\s*transform 180ms ease;\s*\}/,
    );
    expect(css).toMatch(
      /\.bottom-nav\.is-compact:active[\s\S]*?transform:\s*scale\(calc\(0\.9 \* 0\.985\)\);/,
    );
    expect(css).not.toMatch(
      /\.bottom-nav \.nav-item,\s*\.bottom-nav \.nav-symbol/,
    );
    expect(css).toMatch(
      /\.topbar,\s*\.bottom-nav\s*\{\s*transition:\s*none;\s*transform:\s*none;/,
    );
  });
});
