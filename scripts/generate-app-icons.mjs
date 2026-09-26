#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const sourcePath = `${publicDir}icon-source.svg`;

const outputs = [
  { file: "apple-touch-icon.png", size: 180 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-1024.png", size: 1024 },
];

const faviconSizes = [16, 32, 48];

const svg = await readFile(sourcePath);

async function renderPng(size) {
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: "fill" })
    .flatten({ background: "#1b2028" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

for (const { file, size } of outputs) {
  await sharp(await renderPng(size)).toFile(`${publicDir}${file}`);
}

const faviconImages = [];
for (const size of faviconSizes) {
  faviconImages.push({ size, png: await renderPng(size) });
}
await writeFile(`${publicDir}favicon.ico`, icoFromPngs(faviconImages));

console.log(
  `Wrote ${outputs.map(({ file, size }) => `${file} (${size}×${size})`).join(", ")}, favicon.ico (${faviconSizes.join(", ")}) from icon-source.svg`,
);

function icoFromPngs(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    const sizeByte = size >= 256 ? 0 : size;
    entry.writeUInt8(sizeByte, 0);
    entry.writeUInt8(sizeByte, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}
