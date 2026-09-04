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
    expect(nav).toMatch(/transform-origin:\s*bottom center;/);
    expect(compact).toMatch(/transform:\s*scale\(0\.9\);/);
    expect(compact).not.toMatch(/height\s*:/);
    expect(compact).not.toMatch(/padding\s*:/);
    expect(css).not.toMatch(/\.bottom-nav\.is-compact\s+\.nav-item\s*\{/);
    expect(css).not.toMatch(/\.bottom-nav\.is-compact\s+\.nav-symbol\s*\{/);
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
