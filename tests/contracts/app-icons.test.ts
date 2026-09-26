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

const canvas = { r: 0x1b, g: 0x20, b: 0x28 };

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

const accent = { r: 0xe8, g: 0x74, b: 0x3b };

describe("installed app icons", () => {
  it("uses the orange OD mark on blue-gray for PWA icons", async () => {
    const source = await readFile(`${publicDir}icon-source.svg`, "utf8");
    expect(source).toContain('fill="#1b2028"');
    expect(source).toContain('fill="#e8743b"');
    expect(source).not.toContain("#edf0f5");
    expect(source).not.toContain("paper");
    expect(source).not.toContain("#fffaf0");
    expect(source).not.toContain("#f3eee4");

    const webManifest = manifest();
    expect(webManifest).toMatchObject({
      name: "Our Days",
      short_name: "Our Days",
      background_color: "#14110f",
      theme_color: "#14110f",
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
      expect(channelDelta(center, accent)).toBeLessThan(24);
    }

    const favicon = await readFile(`${publicDir}favicon.ico`);
    const embedded = pngsInIco(favicon);
    expect(embedded.map((image) => image.length)).toEqual([16, 32, 48]);
    for (const image of embedded) {
      const { data, info } = await sharp(image.png)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(
        channelDelta({ r: data[0], g: data[1], b: data[2] }, canvas),
      ).toBeLessThan(8);
      const centerIndex =
        (Math.floor(info.height / 2) * info.width +
          Math.floor(info.width / 2)) *
        info.channels;
      expect(
        channelDelta(
          {
            r: data[centerIndex],
            g: data[centerIndex + 1],
            b: data[centerIndex + 2],
          },
          accent,
        ),
      ).toBeLessThan(48);
    }
  });
});

function pngsInIco(file: Buffer) {
  expect(file.readUInt16LE(0)).toBe(0);
  expect(file.readUInt16LE(2)).toBe(1);
  const count = file.readUInt16LE(4);
  const images = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const size = file.readUInt8(entry) || 256;
    const length = file.readUInt32LE(entry + 8);
    const offset = file.readUInt32LE(entry + 12);
    images.push({
      length: size,
      png: file.subarray(offset, offset + length),
    });
  }
  return images;
}
