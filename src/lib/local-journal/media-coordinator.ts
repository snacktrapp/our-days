import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  localJournalMediaDirectory,
  publishLocalMediaMoment,
  sha256Hex,
  type LocalAccess,
} from "./store";
import type { LocalMedia } from "./types";

const maximumPhotoBytes = 25 * 1024 * 1024;
const maximumVideoBytes = 100 * 1024 * 1024;
const maximumVideoDurationMs = 60_500;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const plainDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

export class LocalMediaCoordinatorError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LocalMediaCoordinatorError";
    this.status = status;
  }
}

function sameBytes(actual: Uint8Array, expected: readonly number[]) {
  return expected.every((byte, index) => actual[index] === byte);
}

export function detectPhotoMime(bytes: Uint8Array) {
  if (bytes.length >= 3 && sameBytes(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    sameBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function detectVideoMime(bytes: Uint8Array, declaredType: string) {
  const declared = declaredType.trim().toLowerCase();
  const allowed = new Set([
    "video/mp4",
    "video/quicktime",
    "video/x-m4v",
    "video/webm",
  ]);
  if (!allowed.has(declared)) return null;
  if (declared === "video/webm") {
    return bytes.length >= 4 &&
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
      ? declared
      : null;
  }
  if (bytes.length >= 8) {
    const box = String.fromCharCode(...bytes.slice(4, 8));
    if (box === "ftyp") return declared;
  }
  return null;
}

function requireUuid(value: string, label: string) {
  if (!uuidPattern.test(value)) {
    throw new LocalMediaCoordinatorError(`Check the ${label} and try again.`);
  }
}

function requireDate(value: string) {
  if (!plainDatePattern.test(value)) {
    throw new LocalMediaCoordinatorError("Check the date and try again.");
  }
}

async function writeMediaFiles(
  kind: "photo" | "video",
  original: Buffer,
  originalMime: string,
  sha256: string,
) {
  const mediaId = randomUUID();
  const directory = join(localJournalMediaDirectory(), mediaId);
  mkdirSync(directory, { recursive: true });
  const extension =
    originalMime === "image/png"
      ? "png"
      : originalMime === "image/webp"
        ? "webp"
        : originalMime === "video/webm"
          ? "webm"
          : originalMime === "video/quicktime"
            ? "mov"
            : kind === "video"
              ? "mp4"
              : "jpg";
  const originalRelativePath = `${mediaId}/original.${extension}`;
  writeFileSync(
    join(localJournalMediaDirectory(), originalRelativePath),
    original,
  );

  if (kind === "photo") {
    return {
      mimeType: originalMime,
      byteLength: original.byteLength,
      sha256,
      originalRelativePath,
      displayRelativePath: originalRelativePath,
      displayMimeType: originalMime,
      displayByteLength: original.byteLength,
      displaySha256: sha256,
    } satisfies LocalMedia;
  }

  return {
    mimeType: originalMime,
    byteLength: original.byteLength,
    sha256,
    originalRelativePath,
  } satisfies LocalMedia;
}

export async function publishVerifiedPhotoMoment(
  access: LocalAccess,
  input: Readonly<{
    file: File;
    journalPersonId: string;
    body: string;
    placeName: string;
    taggedPersonIds: readonly string[];
    occurredOn: string;
    occurredAt: string | null;
    occurredTimezone: string | null;
    claimedSha256?: string;
  }>,
) {
  requireUuid(input.journalPersonId, "journal");
  requireDate(input.occurredOn);
  if (input.file.size < 1 || input.file.size > maximumPhotoBytes) {
    throw new LocalMediaCoordinatorError("Choose an image smaller than 25 MB.");
  }
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const mimeType = detectPhotoMime(bytes);
  if (!mimeType) {
    throw new LocalMediaCoordinatorError(
      "For now, choose a JPEG, PNG, or WebP photo.",
    );
  }
  const digest = sha256Hex(bytes);
  if (input.claimedSha256 && input.claimedSha256 !== digest) {
    throw new LocalMediaCoordinatorError(
      "That photo’s contents do not match the prepared upload.",
    );
  }
  const media = await writeMediaFiles("photo", bytes, mimeType, digest);
  return publishLocalMediaMoment(access, {
    kind: "photo",
    journalPersonId: input.journalPersonId,
    body: input.body,
    placeName: input.placeName,
    taggedPersonIds: input.taggedPersonIds,
    occurredOn: input.occurredOn,
    occurredAt: input.occurredAt,
    occurredTimezone: input.occurredTimezone,
    media,
  });
}

export async function publishVerifiedVideoMoment(
  access: LocalAccess,
  input: Readonly<{
    file: File;
    journalPersonId: string;
    body: string;
    placeName: string;
    taggedPersonIds: readonly string[];
    occurredOn: string;
    occurredAt: string | null;
    occurredTimezone: string | null;
    durationMs: number;
  }>,
) {
  requireUuid(input.journalPersonId, "journal");
  requireDate(input.occurredOn);
  if (
    !Number.isInteger(input.durationMs) ||
    input.durationMs < 1 ||
    input.durationMs > maximumVideoDurationMs
  ) {
    throw new LocalMediaCoordinatorError(
      "Choose a video about 60 seconds or shorter.",
    );
  }
  if (input.file.size < 1 || input.file.size > maximumVideoBytes) {
    throw new LocalMediaCoordinatorError("Choose a video smaller than 100 MB.");
  }
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const mimeType = detectVideoMime(bytes, input.file.type);
  if (!mimeType) {
    throw new LocalMediaCoordinatorError(
      "Choose an MP4, MOV, M4V, or WebM video.",
    );
  }
  const media = await writeMediaFiles(
    "video",
    bytes,
    mimeType,
    sha256Hex(bytes),
  );
  return publishLocalMediaMoment(access, {
    kind: "video",
    journalPersonId: input.journalPersonId,
    body: input.body,
    placeName: input.placeName,
    taggedPersonIds: input.taggedPersonIds,
    occurredOn: input.occurredOn,
    occurredAt: input.occurredAt,
    occurredTimezone: input.occurredTimezone,
    media: { ...media, durationMs: input.durationMs },
  });
}

export function readLocalMediaFile(relativePath: string) {
  return readFileSync(join(localJournalMediaDirectory(), relativePath));
}

export function digestBuffer(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
