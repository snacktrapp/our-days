import sharp from "sharp";

const maxSourceEdge = 2560;

// Card WebP settings shared by the upload worker and POST /api/photos/card-backfill.
// The media route's on-demand fallback uses this same pipeline.
export async function renderCardWebp(bytes, width) {
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const output = await sharp(source, {
    animated: false,
    failOn: "error",
    limitInputPixels: maxSourceEdge * maxSourceEdge,
    pages: 1,
    sequentialRead: true,
    unlimited: false,
  })
    .rotate()
    .resize({
      fit: "inside",
      width,
      withoutEnlargement: true,
    })
    .webp({
      effort: 4,
      quality: 73,
      smartSubsample: true,
    })
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: new Uint8Array(output.data),
    height: output.info.height,
    width: output.info.width,
  };
}
