import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("retro theme layer", () => {
  it("scopes every retro rule so Standard cannot inherit it", () => {
    const css = read("src/app/retro.css");
    const stripped = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@font-face\s*\{[\s\S]*?\}/g, "");
    const selectors = [...stripped.matchAll(/([^{}]+)\{/g)].map((match) =>
      match[1].trim(),
    );
    const unscoped = selectors.filter(
      (selector) =>
        selector.length > 0 &&
        !selector.includes('data-appearance="retro"') &&
        selector !== ".insight-byline-avatar > svg",
    );
    expect(unscoped).toEqual([]);
    expect(css).toContain(':root[data-appearance="retro"]');
    expect(css).not.toContain('data-theme="light"');
  });

  it("applies the choice from the existing pre-paint script and allows the wordmark", () => {
    const layout = read("src/app/layout.tsx");
    const proxy = read("src/proxy.ts");
    expect(layout).toContain('import "./retro.css"');
    expect(layout).toContain("themeBootstrapScript");
    expect(layout).toContain('id="our-days-theme"');
    expect(layout).toContain("dangerouslySetInnerHTML");
    expect(layout).not.toContain("beforeInteractive");
    expect(layout).toContain("themeColor: [");
    expect(layout).toContain('"#edf0f4"');
    expect(layout).toContain('"#101216"');
    expect(proxy).toContain("our-days-retro-wordmark\\\\.svg");
  });
});
