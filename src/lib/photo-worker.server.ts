import "server-only";

import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PHOTO_DISPLAY_TRANSFORM_VERSION,
  validatePhotoDisplayByteStream,
  withPhotoDisplayDerivative,
} from "../../scripts/lib/photo-display-derivative.mjs";
import {
  PhotoByteValidationError,
  withValidatedPhotoSpool,
} from "../../scripts/lib/photo-byte-validator.mjs";
import type { Database } from "@/lib/supabase/database.types";
import { readSupabasePublicConfig } from "@/lib/supabase/public-config";

const intakeBucket = "our-days-intake";
const originalsBucket = "our-days-originals";
const displayBucket = "our-days-display";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[0-9a-f]{64}$/u;
export const PHOTO_WORKER_VERSION = "2026-09-01-iphone-hdr-gain-map-v1";

type WorkerClient = SupabaseClient<Database>;
type ValidationLease =
  Database["public"]["Functions"]["claim_photo_validation"]["Returns"][number];
type DerivativeLease =
  Database["public"]["Functions"]["claim_photo_display_derivative"]["Returns"][number];

type ValidatedPhoto = Readonly<{
  channels: number;
  height: number;
  mimeType: string;
  pages: number;
  sha256Hex: string;
  sizeBytes: number;
  stream: NodeJS.ReadableStream;
  width: number;
}>;

type DisplayPhoto = Readonly<{
  channels: number;
  height: number;
  mimeType: "image/webp";
  pages: number;
  sha256Hex: string;
  sizeBytes: number;
  stream: NodeJS.ReadableStream;
  transformVersion: string;
  width: number;
}>;

export class PhotoWorkerError extends Error {
  readonly retryable: boolean;
  readonly stage: string;
  readonly code: string;

  constructor(
    message: string,
    retryable = true,
    stage = "worker",
    code = "PHOTO_WORKER_FAILED",
  ) {
    super(message);
    this.name = "PhotoWorkerError";
    this.retryable = retryable;
    this.stage = stage;
    this.code = code;
  }
}

function requiredWorkerCredential(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new PhotoWorkerError("Photo processing is unavailable.");
  return value;
}

async function authenticatedWorker() {
  const { url, publishableKey } = readSupabasePublicConfig();
  const client = createClient<Database>(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: requiredWorkerCredential("OUR_DAYS_PHOTO_WORKER_EMAIL"),
    password: requiredWorkerCredential("OUR_DAYS_PHOTO_WORKER_PASSWORD"),
  });
  if (error || !data.session?.access_token) {
    throw new PhotoWorkerError("Photo processing is unavailable.");
  }
  return { client, token: data.session.access_token, url, publishableKey };
}

function firstRow<T>(rows: readonly T[] | null, label: string): T {
  const row = rows?.[0];
  if (!row) throw new PhotoWorkerError(`${label} could not be started.`);
  return row;
}

function validValidationLease(row: ValidationLease, intakeId: string) {
  return (
    row.intake_id === intakeId &&
    row.source_bucket_id === intakeBucket &&
    row.source_object_path === `intake/${intakeId}` &&
    row.canonical_bucket_id === originalsBucket &&
    row.canonical_object_path ===
      `original/${row.canonical_object_path.split("/")[1]}/${row.lease_attempt_id}` &&
    uuidPattern.test(row.validation_job_id) &&
    uuidPattern.test(row.lease_attempt_id) &&
    uuidPattern.test(row.source_storage_object_id) &&
    ["image/jpeg", "image/png", "image/webp"].includes(
      row.expected_mime_type,
    ) &&
    Number.isSafeInteger(Number(row.expected_size_bytes)) &&
    Number(row.expected_size_bytes) > 0 &&
    sha256Pattern.test(row.expected_sha256_hex) &&
    Number(row.verification_profile_version) === 1
  );
}

function validDerivativeLease(row: DerivativeLease, originalId: string) {
  return (
    row.original_id === originalId &&
    row.source_bucket_id === originalsBucket &&
    row.display_bucket_id === displayBucket &&
    uuidPattern.test(row.derivative_job_id) &&
    uuidPattern.test(row.lease_attempt_id) &&
    uuidPattern.test(row.source_storage_object_id) &&
    sha256Pattern.test(row.source_sha256_hex) &&
    Number(row.source_size_bytes) > 0 &&
    Number(row.source_width) > 0 &&
    Number(row.source_height) > 0 &&
    Number(row.source_channels) > 0 &&
    Number(row.source_pages) === 1 &&
    Number(row.transform_profile_version) === 1 &&
    row.display_object_path ===
      `display/${row.display_object_path.split("/")[1]}/${row.lease_attempt_id}.webp`
  );
}

function encodedPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function storageRequest(
  config: Readonly<{
    publishableKey: string;
    token: string;
    url: string;
  }>,
  bucket: string,
  objectPath: string,
  init: RequestInit & Readonly<{ duplex?: "half" }> = {},
) {
  return fetch(
    `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath(objectPath)}`,
    {
      ...init,
      headers: {
        apikey: config.publishableKey,
        authorization: `Bearer ${config.token}`,
        ...init.headers,
      },
    } as RequestInit,
  );
}

async function readObject(
  config: Readonly<{
    publishableKey: string;
    token: string;
    url: string;
  }>,
  bucket: string,
  objectPath: string,
) {
  const response = await storageRequest(config, bucket, objectPath, {
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    throw new PhotoWorkerError("Private photo bytes could not be read.");
  }
  return response.body;
}

async function uploadObject(
  config: Readonly<{
    publishableKey: string;
    token: string;
    url: string;
  }>,
  bucket: string,
  objectPath: string,
  contentType: string,
  metadata: object,
  stream: NodeJS.ReadableStream,
) {
  const response = await storageRequest(config, bucket, objectPath, {
    body: stream as unknown as BodyInit,
    duplex: "half",
    headers: {
      "cache-control": "max-age=0",
      "content-type": contentType,
      "x-metadata": Buffer.from(JSON.stringify(metadata)).toString("base64"),
      "x-upsert": "false",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new PhotoWorkerError("Verified photo bytes could not be stored.");
  }
}

async function objectIdentity(
  client: WorkerClient,
  bucket: string,
  objectPath: string,
) {
  const { data, error } = await client.storage.from(bucket).info(objectPath);
  if (error || !data || !uuidPattern.test(data.id) || !data.version) {
    throw new PhotoWorkerError("Verified photo identity was unavailable.");
  }
  return { id: data.id, version: data.version };
}

function originalMetadata(lease: ValidationLease) {
  const [, originalId] = lease.canonical_object_path.split("/");
  return {
    expected_mime_type: lease.expected_mime_type,
    expected_sha256: lease.expected_sha256_hex,
    expected_size_bytes: Number(lease.expected_size_bytes),
    intake_id: lease.intake_id,
    lease_attempt_id: lease.lease_attempt_id,
    original_id: originalId,
    validation_job_id: lease.validation_job_id,
    verification_profile_version: Number(lease.verification_profile_version),
  };
}

function displayMetadata(lease: DerivativeLease, output: DisplayPhoto) {
  return {
    derivative_id: lease.display_object_path.split("/")[1],
    derivative_job_id: lease.derivative_job_id,
    lease_attempt_id: lease.lease_attempt_id,
    maximum_size_bytes: 12 * 1024 * 1024,
    original_id: lease.original_id,
    output_channels: output.channels,
    output_height: output.height,
    output_mime_type: output.mimeType,
    output_pages: output.pages,
    output_sha256: output.sha256Hex,
    output_size_bytes: output.sizeBytes,
    output_width: output.width,
    source_storage_object_id: lease.source_storage_object_id,
    source_storage_object_version: lease.source_storage_object_version,
    transform_profile_version: Number(lease.transform_profile_version),
  };
}

async function rejectValidation(
  client: WorkerClient,
  lease: ValidationLease,
  leaseKey: string,
  reason: string,
) {
  const { error } = await client.rpc("reject_photo_validation", {
    lease_key: leaseKey,
    rejection_reason: reason.slice(0, 120),
    validation_job_id: lease.validation_job_id,
  });
  if (error) {
    throw new PhotoWorkerError("Unsafe photo rejection could not be recorded.");
  }
}

async function flagValidationForReview(
  client: WorkerClient,
  lease: ValidationLease,
  leaseKey: string,
  reason: "canonical_evidence_mismatch" | "validator_cleanup_failed",
) {
  const { error } = await client.rpc("flag_photo_validation_for_review", {
    lease_key: leaseKey,
    review_reason: reason,
    validation_job_id: lease.validation_job_id,
  });
  if (error) {
    throw new PhotoWorkerError("Photo review could not be recorded.");
  }
}

function validationRejectionReason(code: string) {
  if (code === "PHOTO_SIZE_MISMATCH") return "size_mismatch";
  if (code === "PHOTO_HASH_MISMATCH") return "hash_mismatch";
  if (code === "PHOTO_MIME_MISMATCH" || code === "PHOTO_FORMAT_MISMATCH") {
    return "mime_mismatch";
  }
  if (
    code === "PHOTO_MIME_UNSUPPORTED" ||
    code === "PHOTO_FORMAT_UNSUPPORTED"
  ) {
    return "unsupported_format";
  }
  if (
    [
      "PHOTO_BYTE_LIMIT_EXCEEDED",
      "PHOTO_CHANNEL_LIMIT_EXCEEDED",
      "PHOTO_DECODE_LIMIT_EXCEEDED",
      "PHOTO_PAGE_LIMIT_EXCEEDED",
      "PHOTO_PIXEL_LIMIT_EXCEEDED",
    ].includes(code)
  ) {
    return "resource_limit";
  }
  if (code === "PHOTO_DECODE_FAILED") return "decode_failed";
  return null;
}

async function rejectDerivative(
  client: WorkerClient,
  lease: DerivativeLease,
  leaseKey: string,
  reason: "source_changed",
) {
  const { error } = await client.rpc("reject_photo_display_derivative", {
    derivative_job_id: lease.derivative_job_id,
    lease_key: leaseKey,
    rejection_reason: reason,
  });
  if (error) {
    throw new PhotoWorkerError(
      "Unsafe display photo rejection could not be recorded.",
    );
  }
}

async function flagDerivativeForReview(
  client: WorkerClient,
  lease: DerivativeLease,
  leaseKey: string,
  reason: "display_evidence_mismatch" | "validator_cleanup_failed",
) {
  const { error } = await client.rpc(
    "flag_photo_display_derivative_for_review",
    {
      derivative_job_id: lease.derivative_job_id,
      lease_key: leaseKey,
      review_reason: reason,
    },
  );
  if (error) {
    throw new PhotoWorkerError("Display photo review could not be recorded.");
  }
}

async function validateAndPromote(
  worker: Awaited<ReturnType<typeof authenticatedWorker>>,
  intakeId: string,
) {
  const leaseKey = randomUUID();
  const { data, error } = await worker.client.rpc("claim_photo_validation", {
    intake_id: intakeId,
    lease_key: leaseKey,
  });
  if (error)
    throw new PhotoWorkerError("Photo validation could not be claimed.");
  const lease = firstRow(data, "Photo validation");
  if (!validValidationLease(lease, intakeId)) {
    throw new PhotoWorkerError(
      "Photo validation returned an unsafe contract.",
      false,
    );
  }

  try {
    const source = await readObject(
      worker,
      lease.source_bucket_id,
      lease.source_object_path,
    );
    return await withValidatedPhotoSpool(
      source,
      {
        expectedMimeType: lease.expected_mime_type,
        expectedSha256Hex: lease.expected_sha256_hex,
        expectedSizeBytes: Number(lease.expected_size_bytes),
      },
      async (validated: ValidatedPhoto) => {
        await uploadObject(
          worker,
          lease.canonical_bucket_id,
          lease.canonical_object_path,
          validated.mimeType,
          originalMetadata(lease),
          validated.stream,
        );
        const canonical = await readObject(
          worker,
          lease.canonical_bucket_id,
          lease.canonical_object_path,
        );
        await withValidatedPhotoSpool(
          canonical,
          {
            expectedMimeType: validated.mimeType,
            expectedSha256Hex: validated.sha256Hex,
            expectedSizeBytes: validated.sizeBytes,
          },
          async (readBack: ValidatedPhoto) => {
            for await (const chunk of readBack.stream) {
              void chunk;
              // Consume the complete read-back while the validator owns it.
            }
          },
        );
        const identity = await objectIdentity(
          worker.client,
          lease.canonical_bucket_id,
          lease.canonical_object_path,
        );
        const { data: originalId, error: completionError } =
          await worker.client.rpc("complete_photo_validation", {
            lease_key: leaseKey,
            storage_object_id: identity.id,
            storage_object_version: identity.version,
            validation_job_id: lease.validation_job_id,
            verified_channels: validated.channels,
            verified_height: validated.height,
            verified_mime_type: validated.mimeType,
            verified_pages: validated.pages,
            verified_sha256_hex: validated.sha256Hex,
            verified_size_bytes: validated.sizeBytes,
            verified_width: validated.width,
          });
        if (completionError || !originalId || !uuidPattern.test(originalId)) {
          throw new PhotoWorkerError(
            "Photo validation could not be completed.",
          );
        }
        return originalId;
      },
    );
  } catch (error) {
    if (error instanceof PhotoByteValidationError) {
      const rejectionReason = validationRejectionReason(error.code);
      if (rejectionReason) {
        await rejectValidation(worker.client, lease, leaseKey, rejectionReason);
      } else {
        await flagValidationForReview(
          worker.client,
          lease,
          leaseKey,
          error.code === "PHOTO_TEMP_CLEANUP_FAILED"
            ? "validator_cleanup_failed"
            : "canonical_evidence_mismatch",
        );
      }
      throw new PhotoWorkerError(
        "This file could not be verified as a safe photo.",
        false,
        "validation",
        error.code,
      );
    }
    throw error;
  }
}

async function createDisplay(
  worker: Awaited<ReturnType<typeof authenticatedWorker>>,
  originalId: string,
) {
  const leaseKey = randomUUID();
  const { data, error } = await worker.client.rpc(
    "claim_photo_display_derivative",
    { lease_key: leaseKey, original_id: originalId },
  );
  if (error)
    throw new PhotoWorkerError("Photo display work could not be claimed.");
  const lease = firstRow(data, "Photo display work");
  if (!validDerivativeLease(lease, originalId)) {
    throw new PhotoWorkerError(
      "Photo display work returned an unsafe contract.",
      false,
    );
  }

  try {
    const source = await readObject(
      worker,
      lease.source_bucket_id,
      lease.source_object_path,
    );
    return await withValidatedPhotoSpool(
      source,
      {
        expectedMimeType: lease.source_mime_type,
        expectedSha256Hex: lease.source_sha256_hex,
        expectedSizeBytes: Number(lease.source_size_bytes),
      },
      async (validated: ValidatedPhoto) => {
        if (
          validated.width !== Number(lease.source_width) ||
          validated.height !== Number(lease.source_height) ||
          validated.channels !== Number(lease.source_channels) ||
          validated.pages !== Number(lease.source_pages)
        ) {
          throw new PhotoWorkerError("Verified photo geometry changed.", false);
        }
        return withPhotoDisplayDerivative(
          validated,
          {},
          async (output: DisplayPhoto) => {
            if (output.transformVersion !== PHOTO_DISPLAY_TRANSFORM_VERSION) {
              throw new PhotoWorkerError(
                "Photo display profile changed.",
                false,
              );
            }
            await uploadObject(
              worker,
              lease.display_bucket_id,
              lease.display_object_path,
              output.mimeType,
              displayMetadata(lease, output),
              output.stream,
            );
            const displayReadBack = await readObject(
              worker,
              lease.display_bucket_id,
              lease.display_object_path,
            );
            const evidence = await validatePhotoDisplayByteStream(
              displayReadBack,
              {
                expectedChannels: output.channels,
                expectedHeight: output.height,
                expectedPages: output.pages,
                expectedSha256Hex: output.sha256Hex,
                expectedSizeBytes: output.sizeBytes,
                expectedWidth: output.width,
                transformVersion: PHOTO_DISPLAY_TRANSFORM_VERSION,
              },
            );
            const identity = await objectIdentity(
              worker.client,
              lease.display_bucket_id,
              lease.display_object_path,
            );
            const { data: derivativeId, error: completionError } =
              await worker.client.rpc("complete_photo_display_derivative", {
                derivative_job_id: lease.derivative_job_id,
                lease_key: leaseKey,
                output_channels: evidence.channels,
                output_height: evidence.height,
                output_pages: evidence.pages,
                output_sha256_hex: evidence.sha256Hex,
                output_size_bytes: evidence.sizeBytes,
                output_width: evidence.width,
                storage_object_id: identity.id,
                storage_object_version: identity.version,
              });
            if (
              completionError ||
              !derivativeId ||
              !uuidPattern.test(derivativeId)
            ) {
              throw new PhotoWorkerError(
                "Photo display work could not be completed.",
              );
            }
            return derivativeId;
          },
        );
      },
    );
  } catch (error) {
    if (error instanceof PhotoByteValidationError) {
      const sourceChanged = [
        "PHOTO_SIZE_MISMATCH",
        "PHOTO_HASH_MISMATCH",
        "PHOTO_MIME_MISMATCH",
        "PHOTO_FORMAT_MISMATCH",
        "PHOTO_FORMAT_UNSUPPORTED",
        "PHOTO_SPOOL_INTEGRITY_FAILED",
      ].includes(error.code);
      if (sourceChanged) {
        await rejectDerivative(
          worker.client,
          lease,
          leaseKey,
          "source_changed",
        );
      } else {
        await flagDerivativeForReview(
          worker.client,
          lease,
          leaseKey,
          error.code === "PHOTO_TEMP_CLEANUP_FAILED"
            ? "validator_cleanup_failed"
            : "display_evidence_mismatch",
        );
      }
      throw new PhotoWorkerError(
        "This photo could not be prepared safely for display.",
        false,
      );
    }
    throw error;
  }
}

export async function processPhotoIntake(intakeId: string) {
  if (!uuidPattern.test(intakeId)) {
    throw new PhotoWorkerError("Photo intake is invalid.", false);
  }
  const worker = await authenticatedWorker();
  try {
    const originalId = await validateAndPromote(worker, intakeId);
    await createDisplay(worker, originalId);
  } finally {
    await worker.client.auth.signOut({ scope: "local" });
  }
}
