// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

const publicDir = fileURLToPath(new URL("../../public/", import.meta.url));

const iconFiles = [
  { file: "apple-touch-icon.png", size: 180 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-1024.png", size: 1024 },
] as const;

const canvas = { r: 0x0b, g: 0x17, b: 0x12 };

function channelDelta(
  actual: { r: number; g: number; b: number },
  expected: { r: number; g: number; b: number },
) {
  return Math.max(
    Math.abs(actual.r - expected.r),
    Math.abs(actual.g - expected.g),
    Math.abs(actual.b - expected.b),
  );
}

describe("installed app icons", () => {
  it("uses the dark login-page mark for PWA and home-screen chrome", async () => {
    const source = await readFile(`${publicDir}icon-source.svg`, "utf8");
    expect(source).toContain('fill="#0b1712"');
    expect(source).toContain('stroke="#2d433a"');
    expect(source).toContain('fill="#79aaa4"');
    expect(source).toContain('fill="#c77c80"');
    expect(source).toContain('fill="#b88b42"');
    expect(source).not.toContain("paper");
    expect(source).not.toContain("#fffaf0");
    expect(source).not.toContain("#f3eee4");

    const webManifest = manifest();
    expect(webManifest).toMatchObject({
      background_color: "#0b1712",
      theme_color: "#0b1712",
    });
    expect(webManifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icon-192.png", sizes: "192x192" }),
        expect.objectContaining({ src: "/icon-512.png", sizes: "512x512" }),
        expect.objectContaining({
          src: "/icon-512.png",
          purpose: "maskable",
        }),
      ]),
    );

    for (const { file, size } of iconFiles) {
      const image = sharp(`${publicDir}${file}`);
      const metadata = await image.metadata();
      expect(metadata).toMatchObject({
        width: size,
        height: size,
        format: "png",
      });

      const { data, info } = await image
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const corner = {
        r: data[0],
        g: data[1],
        b: data[2],
      };
      expect(channelDelta(corner, canvas)).toBeLessThan(8);

      const centerIndex =
        (Math.floor(info.height / 2) * info.width +
          Math.floor(info.width / 2)) *
        info.channels;
      const center = {
        r: data[centerIndex],
        g: data[centerIndex + 1],
        b: data[centerIndex + 2],
      };
      expect(channelDelta(center, { r: 0xc7, g: 0x7c, b: 0x80 })).toBeLessThan(
        24,
      );
    }
  });
});
