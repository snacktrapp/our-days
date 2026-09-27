import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { renderCardPhotoDetails } from "@/lib/card-photo-rendition.server";

export const cardWidthBudgetMs = 150;

type CardWidth = 1080 | 640;

export type CardRenditionMetadata = {
  card_width: number;
  display_derivative_id: string;
  original_id: string;
  output_height: number;
  output_mime_type: "image/webp";
  output_sha256: string;
  output_size_bytes: number;
  output_width: number;
};

export type StoredCardRecord = {
  cardWidth: CardWidth;
  displayDerivativeId: string;
  outputHeight: number;
  outputSha256Hex: string;
  outputSizeBytes: number;
  outputWidth: number;
  storageObjectId: string;
  storageObjectVersion: string;
};

type StoreCardInput = {
  budgetMs?: number;
  displayBytes: Uint8Array;
  displayDerivativeId: string;
  displayObjectPath: string;
  identity: (objectPath: string) => Promise<{ id: string; version: string }>;
  now?: () => number;
  originalId: string;
  readBack: (objectPath: string) => Promise<Uint8Array>;
  record: (card: StoredCardRecord) => Promise<void>;
  render?: typeof renderCardPhotoDetails;
  upload: (
    objectPath: string,
    bytes: Uint8Array,
    metadata: CardRenditionMetadata,
  ) => Promise<void>;
};

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function cardRenditionObjectPath(
  displayObjectPath: string,
  width: CardWidth,
) {
  return `${displayObjectPath}.card-${width}.webp`;
}

export function cardRenditionMetadata(input: {
  cardWidth: CardWidth;
  displayDerivativeId: string;
  originalId: string;
  outputHeight: number;
  outputSha256Hex: string;
  outputSizeBytes: number;
  outputWidth: number;
}): CardRenditionMetadata {
  return {
    card_width: input.cardWidth,
    display_derivative_id: input.displayDerivativeId,
    original_id: input.originalId,
    output_height: input.outputHeight,
    output_mime_type: "image/webp",
    output_sha256: input.outputSha256Hex,
    output_size_bytes: input.outputSizeBytes,
    output_width: input.outputWidth,
  };
}

export async function rememberPhotoCardRenditions(
  work: () => Promise<unknown>,
) {
  try {
    await work();
  } catch (error) {
    console.error("[photo-card] rendition skipped", {
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function storePhotoCardRenditions(input: StoreCardInput) {
  const now = input.now ?? (() => performance.now());
  const budgetMs = input.budgetMs ?? cardWidthBudgetMs;
  const render = input.render ?? renderCardPhotoDetails;
  const stored: CardWidth[] = [];

  const storeOne = async (width: CardWidth) => {
    const rendered = await render(input.displayBytes, width);
    if (!rendered || rendered.bytes.byteLength === 0) {
      throw new Error("Photo card rendition could not be rendered.");
    }
    const digest = sha256Hex(rendered.bytes);
    const objectPath = cardRenditionObjectPath(input.displayObjectPath, width);
    const metadata = cardRenditionMetadata({
      cardWidth: width,
      displayDerivativeId: input.displayDerivativeId,
      originalId: input.originalId,
      outputHeight: rendered.height,
      outputSha256Hex: digest,
      outputSizeBytes: rendered.bytes.byteLength,
      outputWidth: rendered.width,
    });
    try {
      await input.upload(objectPath, rendered.bytes, metadata);
    } catch (error) {
      const existing = await input.identity(objectPath).catch(() => null);
      if (!existing) throw error;
    }
    const identity = await input.identity(objectPath);
    const readBack = await input.readBack(objectPath);
    if (
      !sameBytes(readBack, rendered.bytes) ||
      sha256Hex(readBack) !== digest
    ) {
      throw new Error("Photo card rendition did not match its upload.");
    }
    await input.record({
      cardWidth: width,
      displayDerivativeId: input.displayDerivativeId,
      outputHeight: rendered.height,
      outputSha256Hex: digest,
      outputSizeBytes: rendered.bytes.byteLength,
      outputWidth: rendered.width,
      storageObjectId: identity.id,
      storageObjectVersion: identity.version,
    });
    stored.push(width);
  };

  const started = now();
  await storeOne(1080);
  if (now() - started < budgetMs) {
    try {
      await storeOne(640);
    } catch (error) {
      console.error("[photo-card] 640 rendition skipped", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return stored;
}
