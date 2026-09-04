#!/usr/bin/env node

import { readFile } from "node:fs/promises";
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

const svg = await readFile(sourcePath);

for (const { file, size } of outputs) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "fill" })
    .flatten({ background: "#0b1712" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(`${publicDir}${file}`);
}

console.log(
  `Wrote ${outputs.map(({ file, size }) => `${file} (${size}×${size})`).join(", ")} from icon-source.svg`,
);
