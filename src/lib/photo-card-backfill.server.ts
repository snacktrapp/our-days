import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import {
  storePhotoCardRenditions,
  type CardRenditionMetadata,
  type StoredCardRecord,
} from "@/lib/photo-card-rendition-store.server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[0-9a-f]{64}$/iu;
const maxDisplayBytes = 12 * 1024 * 1024;

export const photoCardBackfillMaxDurationSeconds = 300;
export const photoCardBackfillHeadroomMs = 15_000;

export const cardBackfillStages = [
  "read",
  "sha",
  "render",
  "upload",
  "identity",
  "readback",
  "record",
] as const;

export type CardBackfillStage = (typeof cardBackfillStages)[number];

export class CardBackfillError extends Error {
  readonly stage: CardBackfillStage;

  constructor(stage: CardBackfillStage) {
    super(stage);
    this.name = "CardBackfillError";
    this.stage = stage;
  }
}

export class PhotoCardBackfillListError extends Error {
  constructor() {
    super("list");
    this.name = "PhotoCardBackfillListError";
  }
}

export type PhotoCardLease = {
  bucketId: string;
  displayDerivativeId: string;
  objectPath: string;
  originalId: string;
  outputSha256Hex: string;
  outputSizeBytes: number;
};

export type PhotoCardBackfillIo = {
  listCandidates: (
    limit: number,
    after: string | null,
  ) => Promise<readonly { id: string }[]>;
  claim: (displayDerivativeId: string) => Promise<PhotoCardLease | null>;
  release: (displayDerivativeId: string) => Promise<void>;
  readDisplay: (lease: PhotoCardLease) => Promise<Uint8Array>;
  upload: (
    lease: PhotoCardLease,
    objectPath: string,
    bytes: Uint8Array,
    metadata: CardRenditionMetadata,
  ) => Promise<void>;
  identity: (
    lease: PhotoCardLease,
    objectPath: string,
  ) => Promise<{ id: string; version: string }>;
  readBack: (lease: PhotoCardLease, objectPath: string) => Promise<Uint8Array>;
  record: (lease: PhotoCardLease, card: StoredCardRecord) => Promise<void>;
};

export type PhotoCardBackfillRequest = {
  live: boolean;
  after: string | null;
  limit: number;
  budgetMs: number;
};

export type PhotoCardBackfillItem = {
  id: string;
  outcome: "made" | "skipped" | "failed";
  stage?: CardBackfillStage;
  ms: number;
};

export type PhotoCardBackfillResult = {
  mode: "dry-run" | "live";
  candidates: number;
  made: number;
  skipped: number;
  failed: number;
  next: string | null;
  elapsedMs: number;
  items: PhotoCardBackfillItem[];
};

type StoreInput = Parameters<typeof storePhotoCardRenditions>[0];
type ClaimedLease = {
  data: readonly unknown[] | null;
  error: unknown;
};

const leaseRefusal = "Photo card rendition lease was not granted.";

export function photoCardBackfillShouldStop(
  elapsedMs: number,
  budgetMs: number,
) {
  if (elapsedMs >= budgetMs) return true;
  return (
    elapsedMs + photoCardBackfillHeadroomMs >=
    photoCardBackfillMaxDurationSeconds * 1000
  );
}

function sameHex(left: string, right: string) {
  const a = Buffer.from(left.toLowerCase(), "utf8");
  const b = Buffer.from(right.toLowerCase(), "utf8");
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

export function displayBytesMatchLease(
  bytes: Uint8Array,
  lease: Pick<PhotoCardLease, "outputSha256Hex" | "outputSizeBytes">,
) {
  if (!Number.isSafeInteger(lease.outputSizeBytes)) return false;
  if (bytes.byteLength !== lease.outputSizeBytes) return false;
  if (bytes.byteLength < 1 || bytes.byteLength > maxDisplayBytes) return false;
  const actual = createHash("sha256").update(bytes).digest("hex");
  return sameHex(actual, lease.outputSha256Hex);
}

function displayObjectPath(id: string, objectPath: string) {
  return new RegExp(
    `^display/${id}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.webp$`,
    "iu",
  ).test(objectPath);
}

export function normalizePhotoCardLease(
  row: unknown,
  requestedId: string,
): PhotoCardLease | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const id = record.display_derivative_id;
  const bucketId = record.bucket_id;
  const objectPath = record.object_path;
  const originalId = record.original_id;
  const sha = record.output_sha256_hex;
  const mime = record.output_mime_type;
  const state = record.state;
  const size = Number(record.output_size_bytes);
  if (typeof id !== "string" || id !== requestedId || !uuidPattern.test(id)) {
    return null;
  }
  if (bucketId !== "our-days-display") return null;
  if (typeof objectPath !== "string" || !displayObjectPath(id, objectPath)) {
    return null;
  }
  if (typeof originalId !== "string" || !uuidPattern.test(originalId)) {
    return null;
  }
  if (typeof sha !== "string" || !sha256Pattern.test(sha)) return null;
  if (!Number.isSafeInteger(size) || size < 1 || size > maxDisplayBytes) {
    return null;
  }
  if (mime !== "image/webp") return null;
  if (state !== "leased") return null;
  return {
    bucketId,
    displayDerivativeId: id,
    objectPath,
    originalId,
    outputSha256Hex: sha.toLowerCase(),
    outputSizeBytes: size,
  };
}

export async function claimPhotoCardBackfillLease(
  claimRpc: () => Promise<ClaimedLease>,
  releaseRpc: () => PromiseLike<unknown>,
  displayDerivativeId: string,
): Promise<PhotoCardLease | null> {
  const claimed = await claimRpc();
  const row = claimed.data?.[0];
  if (claimed.error || !row) return null;
  const lease = normalizePhotoCardLease(row, displayDerivativeId);
  if (!lease) {
    try {
      await releaseRpc();
    } catch {
      // The two-minute lease expires on its own.
    }
    throw new CardBackfillError("read");
  }
  return lease;
}

export async function runLeasedCardRendition<T>(input: {
  claim: () => Promise<T | null>;
  release: () => Promise<void>;
  work: (lease: T) => Promise<void>;
}) {
  const lease = await input.claim();
  if (lease == null) throw new Error(leaseRefusal);
  try {
    await input.work(lease);
  } finally {
    await input.release();
  }
}

function leaseWasRefused(error: unknown) {
  return error instanceof Error && error.message === leaseRefusal;
}

function stageFromStoreError(error: unknown): CardBackfillStage {
  const message = error instanceof Error ? error.message : "";
  if (message === "Photo card rendition could not be rendered.")
    return "render";
  if (message === "Photo card rendition did not match its upload.") {
    return "readback";
  }
  if (message === "Photo card rendition could not be recorded.")
    return "record";
  if (message === "Verified photo identity was unavailable.") return "identity";
  if (message === "Verified photo bytes could not be stored.") return "upload";
  if (message === "Private photo bytes could not be read.") return "read";
  return "upload";
}

async function wrapStage<T>(stage: CardBackfillStage, work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CardBackfillError) throw error;
    throw new CardBackfillError(stage);
  }
}

function pageCursor(listed: readonly { id: string }[], limit: number) {
  if (listed.length !== limit || listed.length === 0) return null;
  const id = listed[listed.length - 1]?.id ?? null;
  if (!id || !uuidPattern.test(id)) return null;
  return id;
}

async function processCandidate(
  io: PhotoCardBackfillIo,
  candidateId: string,
  elapsedMs: () => number,
  render: StoreInput["render"] | undefined,
): Promise<PhotoCardBackfillItem> {
  const itemStarted = elapsedMs();
  const finish = (
    outcome: PhotoCardBackfillItem["outcome"],
    stage?: CardBackfillStage,
  ): PhotoCardBackfillItem => {
    const item: PhotoCardBackfillItem = {
      id: candidateId,
      ms: Math.max(0, Math.round(elapsedMs() - itemStarted)),
      outcome,
    };
    if (stage) item.stage = stage;
    return item;
  };

  try {
    await runLeasedCardRendition({
      claim: () => io.claim(candidateId),
      release: async () => {
        try {
          await io.release(candidateId);
        } catch {
          console.error("[photo-card-backfill] failed", {
            id: candidateId,
            stage: "release",
          });
        }
      },
      work: async (lease) => {
        const displayBytes = await wrapStage("read", () =>
          io.readDisplay(lease),
        );
        if (!displayBytesMatchLease(displayBytes, lease)) {
          throw new CardBackfillError("sha");
        }
        try {
          await storePhotoCardRenditions({
            displayBytes,
            displayDerivativeId: lease.displayDerivativeId,
            displayObjectPath: lease.objectPath,
            identity: (objectPath) =>
              wrapStage("identity", () => io.identity(lease, objectPath)),
            originalId: lease.originalId,
            readBack: (objectPath) =>
              wrapStage("readback", () => io.readBack(lease, objectPath)),
            record: (card) => wrapStage("record", () => io.record(lease, card)),
            render,
            upload: (objectPath, cardBytes, metadata) =>
              wrapStage("upload", () =>
                io.upload(lease, objectPath, cardBytes, metadata),
              ),
          });
        } catch (error) {
          if (error instanceof CardBackfillError) throw error;
          throw new CardBackfillError(stageFromStoreError(error));
        }
      },
    });
    return finish("made");
  } catch (error) {
    if (leaseWasRefused(error)) return finish("skipped");
    const stage =
      error instanceof CardBackfillError
        ? error.stage
        : stageFromStoreError(error);
    console.error("[photo-card-backfill] failed", {
      id: candidateId,
      stage,
    });
    return finish("failed", stage);
  }
}

export async function executePhotoCardBackfill(
  io: PhotoCardBackfillIo,
  request: PhotoCardBackfillRequest,
  elapsedMs: () => number,
  render?: StoreInput["render"],
): Promise<PhotoCardBackfillResult> {
  const page = await io.listCandidates(request.limit, request.after);
  const listed: { id: string }[] = [];
  for (const row of page) {
    if (typeof row?.id === "string" && uuidPattern.test(row.id)) {
      listed.push({ id: row.id });
    }
  }

  const items: PhotoCardBackfillItem[] = [];
  let made = 0;
  let skipped = 0;
  let failed = 0;
  if (request.live) {
    for (const candidate of listed) {
      if (photoCardBackfillShouldStop(elapsedMs(), request.budgetMs)) break;
      const item = await processCandidate(io, candidate.id, elapsedMs, render);
      items.push(item);
      if (item.outcome === "made") made += 1;
      else if (item.outcome === "skipped") skipped += 1;
      else failed += 1;
    }
  }

  return {
    candidates: listed.length,
    elapsedMs: Math.max(0, Math.round(elapsedMs())),
    failed,
    items,
    made,
    mode: request.live ? "live" : "dry-run",
    next: pageCursor(listed, request.limit),
    skipped,
  };
}
