const dataUrlPrefix = "data:image/";

function minimumPosterBytes(width: number, height: number) {
  const maxDimension = Math.max(width, height);
  if (maxDimension >= 1920) return 16_000;
  if (maxDimension >= 1280) return 12_000;
  if (maxDimension >= 720) return 8_000;
  if (maxDimension >= 480) return 5_000;
  return 2_500;
}

export function posterDataUrlByteSize(dataUrl: string) {
  if (!dataUrl.startsWith(dataUrlPrefix)) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const encoded = dataUrl.slice(comma + 1);
  if (!encoded) return null;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.floor((encoded.length * 3) / 4) - padding;
}

export function posterLooksLikelyBlankByBytes(
  sizeBytes: number | null | undefined,
  width: number | null | undefined,
  height: number | null | undefined,
) {
  if (
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes < 1
  ) {
    return false;
  }
  const frameWidth =
    typeof width === "number" && Number.isFinite(width) && width > 0
      ? width
      : 0;
  const frameHeight =
    typeof height === "number" && Number.isFinite(height) && height > 0
      ? height
      : 0;
  const minimum = minimumPosterBytes(frameWidth, frameHeight);
  return sizeBytes < minimum;
}

export function posterDataUrlLooksLikelyBlank(
  dataUrl: string,
  width: number | null | undefined,
  height: number | null | undefined,
) {
  return posterLooksLikelyBlankByBytes(
    posterDataUrlByteSize(dataUrl),
    width,
    height,
  );
}
