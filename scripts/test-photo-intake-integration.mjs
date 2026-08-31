import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  PHOTO_DISPLAY_TRANSFORM_VERSION,
  validatePhotoDisplayByteStream,
  withPhotoDisplayDerivative,
} from "./lib/photo-display-derivative.mjs";
import {
  validatePhotoByteStream,
  withValidatedPhotoSpool,
} from "./lib/photo-byte-validator.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const supabaseBinary = fileURLToPath(
  new URL("../node_modules/.bin/supabase", import.meta.url),
);

const INTAKE_BUCKET = "our-days-intake";
const ORIGINALS_BUCKET = "our-days-originals";
const DISPLAY_BUCKET = "our-days-display";
const PROTECTED_BUCKETS = ["our-days-originals", "our-days-display"];

const CIRCLE_A = "20000000-0000-4000-8000-000000000001";
const CIRCLE_B = "20000000-0000-4000-8000-000000000002";

const ORGANIZER_A = "10000000-0000-4000-8000-000000000001";
const ORGANIZER_A_TWO = "10000000-0000-4000-8000-000000000002";
const MEMBER_A = "10000000-0000-4000-8000-000000000003";
const REVOKED_A = "10000000-0000-4000-8000-000000000004";
const DUAL_CIRCLE_USER = "10000000-0000-4000-8000-000000000005";
const ORGANIZER_B = "10000000-0000-4000-8000-000000000006";
const NO_CIRCLE_USER = "10000000-0000-4000-8000-000000000007";

const PERSON_ORGANIZER_A = "30000000-0000-4000-8000-000000000001";
const PERSON_MEMBER_A = "30000000-0000-4000-8000-000000000003";
const PERSON_REVOKED_A = "30000000-0000-4000-8000-000000000004";
const PERSON_DUAL_B = "30000000-0000-4000-8000-000000000007";
const MEMBER_A_MEMBERSHIP = "40000000-0000-4000-8000-000000000003";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const intakePathPattern =
  /^intake\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[0-9a-f]{64}$/u;

async function readLocalStatus() {
  let output;
  let lastError;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      output = execFileSync(supabaseBinary, ["status", "-o", "env"], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  if (!output) throw lastError;
  if (output.trimStart().startsWith("{")) return JSON.parse(output);

  return Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
}

function resetDatabase() {
  execFileSync(supabaseBinary, ["db", "reset", "--local"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForDatabaseReady() {
  let lastError;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      execFileSync(supabaseBinary, ["db", "query", "--local", "select 1;"], {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error("The local database did not become ready after reset.", {
    cause: lastError,
  });
}

function runDatabaseAssertion(sql) {
  try {
    execFileSync(supabaseBinary, ["db", "query", "--local", sql], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error("A local photo-intake database invariant failed.", {
      cause: error,
    });
  }
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createLocalUserToken(userId, jwtSecret) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    aud: "authenticated",
    exp: issuedAt + 3600,
    iat: issuedAt,
    iss: "supabase-demo",
    role: "authenticated",
    session_id: userId,
    sub: userId,
  });
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function jsonRequest(url, apiKey, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: apiKey,
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  return { body: await parseResponse(response), response };
}

async function rpcRequest(apiUrl, apiKey, token, functionName, body) {
  return jsonRequest(`${apiUrl}/rest/v1/rpc/${functionName}`, apiKey, token, {
    body: JSON.stringify(body),
    method: "POST",
  });
}

function encodedObjectPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function storageRequest(apiUrl, apiKey, token, path, init = {}) {
  return fetch(`${apiUrl}/storage/v1/${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
}

function singleRpcRow(result, operation) {
  const row = Array.isArray(result.body) ? result.body[0] : result.body;
  if (!result.response.ok || !row || typeof row !== "object") {
    throw new Error(
      `${operation} failed with ${result.response.status} (${result.body?.code ?? result.body?.error ?? "no code"}: ${result.body?.message ?? "no message"}).`,
    );
  }
  return row;
}

function validateReservation(row) {
  if (
    !uuidPattern.test(row.intake_id) ||
    row.bucket_id !== INTAKE_BUCKET ||
    !intakePathPattern.test(row.object_path) ||
    row.object_path !== `intake/${row.intake_id}` ||
    row.state !== "reserved" ||
    typeof row.expires_at !== "string"
  ) {
    throw new Error("The reservation RPC returned an invalid opaque contract.");
  }
  return row;
}

function validateUploadClaim(row, reservation) {
  if (
    !row ||
    row.intake_id !== reservation.intake_id ||
    row.bucket_id !== INTAKE_BUCKET ||
    row.object_path !== reservation.object_path ||
    row.state !== "upload_claimed" ||
    typeof row.upload_expires_at !== "string"
  ) {
    throw new Error("The upload-claim RPC returned an invalid bound contract.");
  }
  return row;
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function photoUploadMetadata(
  intakeId,
  uploadRequestKey,
  bytes,
  expectedMimeType = "image/jpeg",
) {
  return {
    expected_mime_type: expectedMimeType,
    expected_sha256: sha256Hex(bytes),
    expected_size_bytes: bytes.length,
    intake_id: intakeId,
    upload_request_key: uploadRequestKey,
  };
}

async function reservePhoto(
  apiUrl,
  apiKey,
  token,
  circleId,
  journalPersonId,
  requestKey,
) {
  return rpcRequest(apiUrl, apiKey, token, "phase4_test_reserve_photo_intake", {
    circle_id: circleId,
    journal_person_id: journalPersonId,
    request_key: requestKey,
  });
}

async function acknowledgePhoto(apiUrl, apiKey, token, intakeId) {
  return rpcRequest(apiUrl, apiKey, token, "acknowledge_photo_intake", {
    intake_id: intakeId,
  });
}

async function claimPhotoUpload(
  apiUrl,
  apiKey,
  token,
  intakeId,
  bytes,
  uploadRequestKey = randomUUID(),
  expectedMimeType = "image/jpeg",
) {
  const uploadMetadata = photoUploadMetadata(
    intakeId,
    uploadRequestKey,
    bytes,
    expectedMimeType,
  );
  if (!sha256Pattern.test(uploadMetadata.expected_sha256)) {
    throw new Error("Synthetic upload digest was not canonical SHA-256.");
  }

  const result = await rpcRequest(
    apiUrl,
    apiKey,
    token,
    "claim_photo_intake_upload",
    {
      expected_mime_type: expectedMimeType,
      expected_sha256_hex: uploadMetadata.expected_sha256,
      expected_size_bytes: bytes.length,
      intake_id: intakeId,
      upload_request_key: uploadRequestKey,
    },
  );
  return { ...result, uploadMetadata };
}

function assertSameReservation(first, second) {
  for (const key of [
    "intake_id",
    "bucket_id",
    "object_path",
    "state",
    "expires_at",
  ]) {
    if (first[key] !== second[key]) {
      throw new Error("Reservation idempotency did not converge.");
    }
  }
}

function assertSameAcknowledgement(first, second, expectedSize) {
  for (const key of [
    "intake_id",
    "bucket_id",
    "object_path",
    "state",
    "expires_at",
    "observed_mime_type_unverified",
    "observed_size_bytes_unverified",
  ]) {
    if (first[key] !== second[key]) {
      throw new Error("Acknowledgement idempotency did not converge.");
    }
  }

  if (
    first.state !== "uploaded_unverified" ||
    first.observed_mime_type_unverified !== "image/jpeg" ||
    Number(first.observed_size_bytes_unverified) !== expectedSize
  ) {
    throw new Error(
      "Acknowledgement did not preserve unverified observations.",
    );
  }
}

async function expectRpcDenied(promise, label) {
  const result = await promise;
  if (result.response.ok) {
    throw new Error(`${label} unexpectedly succeeded.`);
  }
  assertSafeDenial(result.response, result.body, label);
}

function assertSafeDenial(response, body, label) {
  if (
    response.status >= 500 ||
    body?.code === "40P01" ||
    body?.error === "40P01"
  ) {
    throw new Error(
      `${label} did not use a safe denial (${response.status}, ${body?.code ?? body?.error ?? "no code"}).`,
    );
  }
}

async function expectReservationReplayUnusable(promise, original, label) {
  const result = await promise;
  if (!result.response.ok) {
    assertSafeDenial(result.response, result.body, label);
    return;
  }

  const row = Array.isArray(result.body) ? result.body[0] : result.body;
  if (
    !row ||
    row.intake_id !== original.intake_id ||
    row.bucket_id !== original.bucket_id ||
    row.object_path !== original.object_path ||
    row.state !== "invalidated"
  ) {
    throw new Error(`${label} unexpectedly returned a stale capability.`);
  }
}

async function expectStorageWriteDenied(promise, label) {
  const response = await promise;
  const body = await parseResponse(response);
  if (response.ok) throw new Error(`${label} unexpectedly succeeded.`);
  assertSafeDenial(response, body, label);
}

async function expectStorageReadDenied(promise, label) {
  const response = await promise;
  const body = await parseResponse(response);
  if (!response.ok) {
    assertSafeDenial(response, body, label);
    return;
  }
  if (Array.isArray(body) && body.length === 0) return;
  throw new Error(`${label} unexpectedly disclosed a protected object.`);
}

async function uploadObject(
  apiUrl,
  apiKey,
  token,
  bucket,
  objectPath,
  bytes,
  upsert = false,
  contentType = "image/jpeg",
) {
  return storageRequest(
    apiUrl,
    apiKey,
    token,
    `object/${encodeURIComponent(bucket)}/${encodedObjectPath(objectPath)}`,
    {
      body: bytes,
      headers: {
        "content-type": contentType,
        "x-upsert": String(upsert),
      },
      method: "POST",
    },
  );
}

async function updateObject(apiUrl, apiKey, token, bucket, objectPath, bytes) {
  return storageRequest(
    apiUrl,
    apiKey,
    token,
    `object/${encodeURIComponent(bucket)}/${encodedObjectPath(objectPath)}`,
    {
      body: bytes,
      headers: { "content-type": "image/jpeg", "x-upsert": "false" },
      method: "PUT",
    },
  );
}

async function createSignedUploadUrl(
  apiUrl,
  apiKey,
  token,
  bucket,
  objectPath,
  upsert,
) {
  return storageRequest(
    apiUrl,
    apiKey,
    token,
    `object/upload/sign/${encodeURIComponent(bucket)}/${encodedObjectPath(objectPath)}`,
    {
      body: JSON.stringify({}),
      headers: {
        "content-type": "application/json",
        "x-upsert": String(upsert),
      },
      method: "POST",
    },
  );
}

function tusMetadataValue(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function createResumableUpload(
  apiUrl,
  apiKey,
  token,
  bucket,
  objectPath,
  byteLength,
  uploadMetadata,
  upsert = false,
) {
  const metadata = [
    `bucketName ${tusMetadataValue(bucket)}`,
    `objectName ${tusMetadataValue(objectPath)}`,
    `contentType ${tusMetadataValue("image/jpeg")}`,
    `cacheControl ${tusMetadataValue("3600")}`,
    ...(uploadMetadata
      ? [`metadata ${tusMetadataValue(JSON.stringify(uploadMetadata))}`]
      : []),
  ].join(",");

  return storageRequest(apiUrl, apiKey, token, "upload/resumable", {
    headers: {
      "tus-resumable": "1.0.0",
      "upload-length": String(byteLength),
      "upload-metadata": metadata,
      "x-upsert": String(upsert),
    },
    method: "POST",
  });
}

function resumableUploadUrl(apiUrl, response) {
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("TUS creation succeeded without a Location header.");
  }

  const url = new URL(location, `${apiUrl}/storage/v1/upload/resumable`);
  if (url.origin !== new URL(apiUrl).origin) {
    throw new Error("TUS creation returned an unexpected origin.");
  }
  return url.toString();
}

async function patchResumableUpload(apiKey, token, uploadUrl, bytes) {
  return fetch(uploadUrl, {
    body: bytes,
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/offset+octet-stream",
      "tus-resumable": "1.0.0",
      "upload-offset": "0",
      "x-upsert": "false",
    },
    method: "PATCH",
  });
}

async function uploadClaimedTus(
  apiUrl,
  apiKey,
  token,
  reservation,
  bytes,
  uploadMetadata,
) {
  const creation = await createResumableUpload(
    apiUrl,
    apiKey,
    token,
    INTAKE_BUCKET,
    reservation.object_path,
    bytes.length,
    uploadMetadata,
  );
  if (!creation.ok) return { creation, patch: null };

  const patch = await patchResumableUpload(
    apiKey,
    token,
    resumableUploadUrl(apiUrl, creation),
    bytes,
  );
  return { creation, patch };
}

function validateValidationLease(row, reservation) {
  if (
    !row ||
    !uuidPattern.test(row.validation_job_id) ||
    !uuidPattern.test(row.lease_attempt_id) ||
    row.intake_id !== reservation.intake_id ||
    row.source_bucket_id !== INTAKE_BUCKET ||
    row.source_object_path !== reservation.object_path ||
    !uuidPattern.test(row.source_storage_object_id) ||
    typeof row.source_storage_object_version !== "string" ||
    row.canonical_bucket_id !== ORIGINALS_BUCKET ||
    !/^original\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/iu.test(
      row.canonical_object_path,
    ) ||
    row.canonical_object_path.split("/")[2] !== row.lease_attempt_id ||
    row.expected_mime_type !== "image/jpeg" ||
    !sha256Pattern.test(row.expected_sha256_hex) ||
    Number(row.verification_profile_version) !== 1 ||
    typeof row.lease_expires_at !== "string"
  ) {
    throw new Error("The validator lease returned an invalid opaque contract.");
  }
  return row;
}

function validateDerivativeLease(row, originalId) {
  if (
    !row ||
    !uuidPattern.test(row.derivative_job_id) ||
    !uuidPattern.test(row.lease_attempt_id) ||
    row.original_id !== originalId ||
    row.source_bucket_id !== ORIGINALS_BUCKET ||
    !/^original\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/iu.test(
      row.source_object_path,
    ) ||
    !uuidPattern.test(row.source_storage_object_id) ||
    typeof row.source_storage_object_version !== "string" ||
    row.source_mime_type !== "image/jpeg" ||
    Number(row.source_size_bytes) < 1 ||
    !sha256Pattern.test(row.source_sha256_hex) ||
    Number(row.source_width) < 1 ||
    Number(row.source_height) < 1 ||
    Number(row.source_channels) < 1 ||
    Number(row.source_pages) !== 1 ||
    row.display_bucket_id !== DISPLAY_BUCKET ||
    !/^display\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/iu.test(
      row.display_object_path,
    ) ||
    row.display_object_path.split("/")[2].replace(/\.webp$/u, "") !==
      row.lease_attempt_id ||
    Number(row.transform_profile_version) !== 1 ||
    typeof row.lease_expires_at !== "string"
  ) {
    throw new Error(
      "The derivative lease returned an invalid exact-source contract.",
    );
  }
  return row;
}

function canonicalUserMetadata(lease) {
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

async function uploadValidatedOriginal(
  apiUrl,
  apiKey,
  token,
  lease,
  validatedStream,
) {
  return storageRequest(
    apiUrl,
    apiKey,
    token,
    `object/${encodeURIComponent(ORIGINALS_BUCKET)}/${encodedObjectPath(lease.canonical_object_path)}`,
    {
      body: validatedStream,
      duplex: "half",
      headers: {
        "cache-control": "max-age=0",
        "content-type": lease.expected_mime_type,
        "x-metadata": Buffer.from(
          JSON.stringify(canonicalUserMetadata(lease)),
        ).toString("base64"),
        "x-upsert": "false",
      },
      method: "POST",
    },
  );
}

function displayUserMetadata(lease, output) {
  return {
    derivative_id: lease.display_object_path.split("/")[1],
    derivative_job_id: lease.derivative_job_id,
    lease_attempt_id: lease.lease_attempt_id,
    maximum_size_bytes: 12 * 1024 * 1024,
    original_id: lease.original_id,
    output_channels: output.channels,
    output_height: output.height,
    output_mime_type: "image/webp",
    output_pages: output.pages,
    output_sha256: output.sha256Hex,
    output_size_bytes: output.sizeBytes,
    output_width: output.width,
    source_storage_object_id: lease.source_storage_object_id,
    source_storage_object_version: lease.source_storage_object_version,
    transform_profile_version: Number(lease.transform_profile_version),
  };
}

async function uploadValidatedDisplay(
  apiUrl,
  apiKey,
  token,
  lease,
  output,
  derivativeStream,
  contentType = "image/webp",
) {
  return storageRequest(
    apiUrl,
    apiKey,
    token,
    `object/${encodeURIComponent(DISPLAY_BUCKET)}/${encodedObjectPath(lease.display_object_path)}`,
    {
      body: derivativeStream,
      duplex: "half",
      headers: {
        "cache-control": "max-age=0",
        "content-type": contentType,
        "x-metadata": Buffer.from(
          JSON.stringify(displayUserMetadata(lease, output)),
        ).toString("base64"),
        "x-upsert": "false",
      },
      method: "POST",
    },
  );
}

async function authenticatedObjectRead(
  apiUrl,
  apiKey,
  token,
  bucket,
  objectPath,
) {
  return storageRequest(
    apiUrl,
    apiKey,
    token,
    `object/${encodeURIComponent(bucket)}/${encodedObjectPath(objectPath)}`,
    { headers: { "cache-control": "no-store" } },
  );
}

async function authenticatedObjectInfo(
  apiUrl,
  apiKey,
  token,
  bucket,
  objectPath,
) {
  return jsonRequest(
    `${apiUrl}/storage/v1/object/info/${encodeURIComponent(bucket)}/${encodedObjectPath(objectPath)}`,
    apiKey,
    token,
  );
}

async function deleteObjects(apiUrl, apiKey, token, bucket, objectPaths) {
  return storageRequest(
    apiUrl,
    apiKey,
    token,
    `object/${encodeURIComponent(bucket)}`,
    {
      body: JSON.stringify({ prefixes: objectPaths }),
      headers: { "content-type": "application/json" },
      method: "DELETE",
    },
  );
}

async function assertObjectOperationsDenied(
  apiUrl,
  apiKey,
  token,
  bucket,
  objectPath,
  label,
  cleanupEntries,
) {
  await expectStorageReadDenied(
    storageRequest(
      apiUrl,
      apiKey,
      token,
      `object/list/${encodeURIComponent(bucket)}`,
      {
        body: JSON.stringify({ limit: 100, offset: 0, prefix: "" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ),
    `${label} list`,
  );

  await expectStorageReadDenied(
    storageRequest(
      apiUrl,
      apiKey,
      token,
      `object/${encodeURIComponent(bucket)}/${encodedObjectPath(objectPath)}`,
    ),
    `${label} read`,
  );

  await expectStorageWriteDenied(
    updateObject(
      apiUrl,
      apiKey,
      token,
      bucket,
      objectPath,
      Buffer.from([0x75, 0x70, 0x64, 0x61, 0x74, 0x65]),
    ),
    `${label} update`,
  );

  const deletion = await deleteObjects(apiUrl, apiKey, token, bucket, [
    objectPath,
  ]);
  const deletionBody = await parseResponse(deletion);
  if (deletion.ok) {
    if (!Array.isArray(deletionBody) || deletionBody.length !== 0) {
      throw new Error(
        `${label} delete unexpectedly removed a protected object.`,
      );
    }
  } else {
    assertSafeDenial(deletion, deletionBody, `${label} delete`);
  }

  await expectStorageWriteDenied(
    storageRequest(
      apiUrl,
      apiKey,
      token,
      `object/sign/${encodeURIComponent(bucket)}/${encodedObjectPath(objectPath)}`,
      {
        body: JSON.stringify({ expiresIn: 60 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ),
    `${label} signed URL`,
  );

  for (const operation of ["copy", "move"]) {
    const destinationPath = `phase-4a-denied/${randomUUID()}`;
    cleanupEntries.push({ bucket, objectPath: destinationPath });
    await expectStorageWriteDenied(
      storageRequest(apiUrl, apiKey, token, `object/${operation}`, {
        body: JSON.stringify({
          bucketId: bucket,
          destinationBucket: bucket,
          destinationKey: destinationPath,
          sourceKey: objectPath,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      `${label} ${operation}`,
    );
  }
}

async function cleanupObjects(apiUrl, serviceKey, entries) {
  const byBucket = new Map();
  for (const { bucket, objectPath } of entries) {
    const paths = byBucket.get(bucket) ?? new Set();
    paths.add(objectPath);
    byBucket.set(bucket, paths);
  }

  for (const [bucket, paths] of byBucket) {
    const exactPaths = [...paths];
    const response = await deleteObjects(
      apiUrl,
      serviceKey,
      serviceKey,
      bucket,
      exactPaths,
    );
    await parseResponse(response);
    if (!response.ok) {
      throw new Error("Exact local Storage fixture cleanup failed.");
    }

    for (const objectPath of exactPaths) {
      const readBack = await storageRequest(
        apiUrl,
        serviceKey,
        serviceKey,
        `object/${encodeURIComponent(bucket)}/${encodedObjectPath(objectPath)}`,
      );
      const body = await parseResponse(readBack);
      if (readBack.ok) {
        throw new Error("Exact local Storage fixture remained after cleanup.");
      }
      assertSafeDenial(readBack, body, "Storage cleanup read-back");
    }
  }
}

let shouldRestoreFixtures = false;
let storageContext = null;
let primaryError = null;

try {
  resetDatabase();
  await waitForDatabaseReady();
  runDatabaseAssertion(`
    insert into auth.sessions (
      id, user_id, created_at, updated_at, not_after
    )
    select auth_user.id, auth_user.id, statement_timestamp(),
      statement_timestamp(), statement_timestamp() + interval '1 day'
      from auth.users as auth_user
    on conflict (id) do nothing;
  `);
  runDatabaseAssertion(`
    update private.photo_capabilities
       set enabled = true,
           updated_at = statement_timestamp()
     where capability = 'photo_publication';
  `);
  runDatabaseAssertion(`
    do $install_raw_intake_harness$
    begin
      execute $definition$
        create function public.phase4_test_reserve_photo_intake(
          circle_id uuid, journal_person_id uuid, request_key uuid
        )
        returns table (
          intake_id uuid, bucket_id text, object_path text, state text,
          expires_at timestamptz
        )
        language sql volatile security definer set search_path = '' as $body$
          select * from private.reserve_photo_intake(
            circle_id, journal_person_id, request_key
          );
        $body$
      $definition$;
      execute 'revoke all on function public.phase4_test_reserve_photo_intake(uuid, uuid, uuid) from public, anon, authenticated, service_role';
      execute 'grant execute on function public.phase4_test_reserve_photo_intake(uuid, uuid, uuid) to authenticated';
      perform pg_catalog.pg_notify('pgrst', 'reload schema');
    end
    $install_raw_intake_harness$;
  `);
  shouldRestoreFixtures = true;

  const status = await readLocalStatus();
  const apiUrl = status.API_URL;
  const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  const jwtSecret = status.JWT_SECRET;

  if (!apiUrl || !anonKey || !serviceKey || !jwtSecret) {
    throw new Error("Local Supabase status omitted an integration value.");
  }

  const cleanupEntries = [];
  storageContext = { apiUrl, cleanupEntries, serviceKey };

  const tokens = Object.fromEntries(
    Object.entries({
      dualCircle: DUAL_CIRCLE_USER,
      memberA: MEMBER_A,
      noCircle: NO_CIRCLE_USER,
      organizerA: ORGANIZER_A,
      organizerATwo: ORGANIZER_A_TWO,
      organizerB: ORGANIZER_B,
      revokedA: REVOKED_A,
    }).map(([label, userId]) => [
      label,
      createLocalUserToken(userId, jwtSecret),
    ]),
  );

  const successfulRequestKey = randomUUID();
  const firstReservation = validateReservation(
    singleRpcRow(
      await reservePhoto(
        apiUrl,
        anonKey,
        tokens.organizerA,
        CIRCLE_A,
        PERSON_ORGANIZER_A,
        successfulRequestKey,
      ),
      "Photo reservation",
    ),
  );
  cleanupEntries.push({
    bucket: INTAKE_BUCKET,
    objectPath: firstReservation.object_path,
  });

  const repeatedReservation = validateReservation(
    singleRpcRow(
      await reservePhoto(
        apiUrl,
        anonKey,
        tokens.organizerA,
        CIRCLE_A,
        PERSON_ORGANIZER_A,
        successfulRequestKey,
      ),
      "Repeated photo reservation",
    ),
  );
  assertSameReservation(firstReservation, repeatedReservation);

  await expectRpcDenied(
    acknowledgePhoto(
      apiUrl,
      anonKey,
      tokens.organizerA,
      firstReservation.intake_id,
    ),
    "Acknowledgement before upload",
  );

  const deniedReservationCases = [
    {
      circleId: CIRCLE_A,
      journalPersonId: PERSON_ORGANIZER_A,
      label: "Anonymous reservation",
      token: null,
    },
    {
      circleId: CIRCLE_A,
      journalPersonId: PERSON_ORGANIZER_A,
      label: "No-circle reservation",
      token: tokens.noCircle,
    },
    {
      circleId: CIRCLE_A,
      journalPersonId: PERSON_ORGANIZER_A,
      label: "Wrong-circle reservation",
      token: tokens.organizerB,
    },
    {
      circleId: CIRCLE_A,
      journalPersonId: PERSON_ORGANIZER_A,
      label: "Wrong-member journal reservation",
      token: tokens.memberA,
    },
    {
      circleId: CIRCLE_A,
      journalPersonId: PERSON_REVOKED_A,
      label: "Revoked-member reservation",
      token: tokens.revokedA,
    },
  ];

  for (const denied of deniedReservationCases) {
    await expectRpcDenied(
      reservePhoto(
        apiUrl,
        anonKey,
        denied.token,
        denied.circleId,
        denied.journalPersonId,
        randomUUID(),
      ),
      denied.label,
    );
  }

  const syntheticOriginal = await sharp({
    create: {
      background: { b: 57, g: 126, r: 180 },
      channels: 3,
      height: 7,
      width: 11,
    },
  })
    .jpeg({ quality: 82 })
    .toBuffer();
  const syntheticDisplayCanary = await sharp(syntheticOriginal)
    .webp({ effort: 4, quality: 80 })
    .toBuffer();

  const unauthorizedUploadCases = [
    { label: "Anonymous reserved-path upload", token: null },
    { label: "No-circle reserved-path upload", token: tokens.noCircle },
    { label: "Wrong-circle reserved-path upload", token: tokens.organizerB },
    { label: "Wrong-member reserved-path upload", token: tokens.memberA },
    { label: "Revoked reserved-path upload", token: tokens.revokedA },
  ];

  for (const denied of unauthorizedUploadCases) {
    await expectStorageWriteDenied(
      uploadObject(
        apiUrl,
        anonKey,
        denied.token,
        INTAKE_BUCKET,
        firstReservation.object_path,
        syntheticOriginal,
      ),
      denied.label,
    );
  }

  await expectStorageWriteDenied(
    uploadObject(
      apiUrl,
      anonKey,
      tokens.organizerA,
      INTAKE_BUCKET,
      firstReservation.object_path,
      syntheticOriginal,
    ),
    "Standard authenticated upload before claim",
  );

  for (const upsert of [false, true]) {
    await expectStorageWriteDenied(
      createSignedUploadUrl(
        apiUrl,
        anonKey,
        tokens.organizerA,
        INTAKE_BUCKET,
        firstReservation.object_path,
        upsert,
      ),
      `Signed-upload bearer capability with upsert=${upsert}`,
    );
  }

  await expectStorageWriteDenied(
    createResumableUpload(
      apiUrl,
      anonKey,
      tokens.organizerA,
      INTAKE_BUCKET,
      firstReservation.object_path,
      syntheticOriginal.length,
      photoUploadMetadata(
        firstReservation.intake_id,
        randomUUID(),
        syntheticOriginal,
      ),
    ),
    "TUS creation before fingerprint claim",
  );

  await expectRpcDenied(
    claimPhotoUpload(
      apiUrl,
      anonKey,
      tokens.memberA,
      firstReservation.intake_id,
      syntheticOriginal,
    ),
    "Wrong-actor fingerprint claim",
  );

  const fabricatedPath = `intake/${randomUUID()}`;
  cleanupEntries.push({ bucket: INTAKE_BUCKET, objectPath: fabricatedPath });
  await expectStorageWriteDenied(
    uploadObject(
      apiUrl,
      anonKey,
      tokens.organizerA,
      INTAKE_BUCKET,
      fabricatedPath,
      syntheticOriginal,
    ),
    "Fabricated-path upload",
  );

  for (const bucket of PROTECTED_BUCKETS) {
    await expectStorageWriteDenied(
      uploadObject(
        apiUrl,
        anonKey,
        tokens.organizerA,
        bucket,
        firstReservation.object_path,
        syntheticOriginal,
      ),
      "Wrong-bucket upload",
    );
  }

  const uploadClaimResult = await claimPhotoUpload(
    apiUrl,
    anonKey,
    tokens.organizerA,
    firstReservation.intake_id,
    syntheticOriginal,
  );
  const uploadClaim = validateUploadClaim(
    singleRpcRow(uploadClaimResult, "Fingerprint-bound upload claim"),
    firstReservation,
  );

  await expectStorageWriteDenied(
    createResumableUpload(
      apiUrl,
      anonKey,
      tokens.organizerA,
      INTAKE_BUCKET,
      uploadClaim.object_path,
      syntheticOriginal.length,
      uploadClaimResult.uploadMetadata,
      true,
    ),
    "TUS upsert creation after fingerprint claim",
  );

  await expectStorageWriteDenied(
    uploadObject(
      apiUrl,
      anonKey,
      tokens.organizerA,
      INTAKE_BUCKET,
      firstReservation.object_path,
      syntheticOriginal,
      false,
    ),
    "Standard upload after TUS claim",
  );
  await expectStorageWriteDenied(
    uploadObject(
      apiUrl,
      anonKey,
      tokens.organizerA,
      INTAKE_BUCKET,
      firstReservation.object_path,
      syntheticOriginal,
      true,
    ),
    "Standard overwrite after TUS claim",
  );

  await expectStorageWriteDenied(
    createResumableUpload(
      apiUrl,
      anonKey,
      tokens.memberA,
      INTAKE_BUCKET,
      uploadClaim.object_path,
      syntheticOriginal.length,
      uploadClaimResult.uploadMetadata,
    ),
    "Wrong-actor TUS creation after claim",
  );

  // Phase 4A's separate concurrency harness proves that two preauthorized TUS
  // URLs can both complete. This fault-injection byte set lets Phase 4B prove
  // the complementary property: once exact bytes are spooled and promoted,
  // any later quarantine replacement cannot alter or veto canonical bytes.
  const lateQuarantineBytes = Buffer.from(syntheticOriginal);
  lateQuarantineBytes[Math.floor(lateQuarantineBytes.length / 2)] ^= 0x01;

  const claimedTusUpload = await uploadClaimedTus(
    apiUrl,
    anonKey,
    tokens.organizerA,
    uploadClaim,
    syntheticOriginal,
    uploadClaimResult.uploadMetadata,
  );
  if (!claimedTusUpload.creation.ok || !claimedTusUpload.patch?.ok) {
    throw new Error(
      `Exact claimed TUS upload failed with ${claimedTusUpload.creation.status}/${claimedTusUpload.patch?.status ?? "no PATCH"}.`,
    );
  }

  for (const denied of [
    { label: "Anonymous acknowledgement", token: null },
    { label: "No-circle acknowledgement", token: tokens.noCircle },
    { label: "Wrong-circle acknowledgement", token: tokens.organizerB },
    { label: "Wrong-member acknowledgement", token: tokens.memberA },
    { label: "Revoked-member acknowledgement", token: tokens.revokedA },
  ]) {
    await expectRpcDenied(
      acknowledgePhoto(
        apiUrl,
        anonKey,
        denied.token,
        firstReservation.intake_id,
      ),
      denied.label,
    );
  }

  const firstAcknowledgement = singleRpcRow(
    await acknowledgePhoto(
      apiUrl,
      anonKey,
      tokens.organizerA,
      firstReservation.intake_id,
    ),
    "Photo acknowledgement",
  );
  const repeatedAcknowledgement = singleRpcRow(
    await acknowledgePhoto(
      apiUrl,
      anonKey,
      tokens.organizerA,
      firstReservation.intake_id,
    ),
    "Repeated photo acknowledgement",
  );
  assertSameAcknowledgement(
    firstAcknowledgement,
    repeatedAcknowledgement,
    syntheticOriginal.length,
  );
  await expectStorageWriteDenied(
    createResumableUpload(
      apiUrl,
      anonKey,
      tokens.organizerA,
      INTAKE_BUCKET,
      firstReservation.object_path,
      syntheticOriginal.length,
      uploadClaimResult.uploadMetadata,
    ),
    "TUS creation after uploaded-unverified acknowledgement",
  );

  await assertObjectOperationsDenied(
    apiUrl,
    anonKey,
    tokens.organizerA,
    INTAKE_BUCKET,
    firstReservation.object_path,
    "Quarantined intake object",
    cleanupEntries,
  );
  for (const denied of [
    { label: "Anonymous quarantined object", token: null },
    { label: "No-circle quarantined object", token: tokens.noCircle },
    {
      label: "Wrong-circle quarantined object",
      token: tokens.organizerB,
    },
    { label: "Wrong-member quarantined object", token: tokens.memberA },
    { label: "Revoked-member quarantined object", token: tokens.revokedA },
  ]) {
    await assertObjectOperationsDenied(
      apiUrl,
      anonKey,
      denied.token,
      INTAKE_BUCKET,
      firstReservation.object_path,
      denied.label,
      cleanupEntries,
    );
  }

  for (const bucket of PROTECTED_BUCKETS) {
    const canaryPath = `phase-4a/${randomUUID()}`;
    const isDisplayBucket = bucket === DISPLAY_BUCKET;
    cleanupEntries.push({ bucket, objectPath: canaryPath });
    const seeded = await uploadObject(
      apiUrl,
      serviceKey,
      serviceKey,
      bucket,
      canaryPath,
      isDisplayBucket ? syntheticDisplayCanary : syntheticOriginal,
      false,
      isDisplayBucket ? "image/webp" : "image/jpeg",
    );
    await parseResponse(seeded);
    if (!seeded.ok) {
      throw new Error(
        `Trusted protected-bucket fixture creation failed with ${seeded.status}.`,
      );
    }

    const publicRead = await fetch(
      `${apiUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedObjectPath(canaryPath)}`,
    );
    const publicReadBody = await parseResponse(publicRead);
    if (publicRead.ok) {
      throw new Error("A protected bucket exposed a public object URL.");
    }
    assertSafeDenial(
      publicRead,
      publicReadBody,
      "Protected-bucket public read",
    );

    await assertObjectOperationsDenied(
      apiUrl,
      anonKey,
      tokens.organizerA,
      bucket,
      canaryPath,
      "Protected retained-media object",
      cleanupEntries,
    );
    await assertObjectOperationsDenied(
      apiUrl,
      anonKey,
      null,
      bucket,
      canaryPath,
      "Anonymous protected retained-media object",
      cleanupEntries,
    );

    const deniedUploadPath = `phase-4a/${randomUUID()}`;
    cleanupEntries.push({ bucket, objectPath: deniedUploadPath });
    await expectStorageWriteDenied(
      uploadObject(
        apiUrl,
        anonKey,
        tokens.organizerA,
        bucket,
        deniedUploadPath,
        syntheticOriginal,
      ),
      "Protected retained-media upload",
    );
  }

  await expectRpcDenied(
    rpcRequest(apiUrl, anonKey, tokens.organizerA, "claim_photo_validation", {
      intake_id: firstReservation.intake_id,
      lease_key: randomUUID(),
    }),
    "Family organizer validator claim",
  );

  // Local-only worker activation is an explicit out-of-band trusted action.
  // This synthetic no-circle Auth identity receives no family membership and
  // no service key; Storage RLS limits it to one live leased source/path.
  runDatabaseAssertion(`
    insert into private.photo_validator_allowlist (auth_user_id)
    values ('${NO_CIRCLE_USER}'::uuid);
  `);

  const validationLeaseKey = randomUUID();
  const validationLease = validateValidationLease(
    singleRpcRow(
      await rpcRequest(
        apiUrl,
        anonKey,
        tokens.noCircle,
        "claim_photo_validation",
        {
          intake_id: firstReservation.intake_id,
          lease_key: validationLeaseKey,
        },
      ),
      "Validator lease",
    ),
    firstReservation,
  );
  if (
    Number(validationLease.expected_size_bytes) !== syntheticOriginal.length
  ) {
    throw new Error("The validator lease changed the claimed byte count.");
  }

  await expectRpcDenied(
    rpcRequest(apiUrl, anonKey, tokens.noCircle, "claim_photo_validation", {
      intake_id: firstReservation.intake_id,
      lease_key: randomUUID(),
    }),
    "Live validator lease theft",
  );
  await expectStorageReadDenied(
    storageRequest(
      apiUrl,
      anonKey,
      tokens.noCircle,
      `object/list/${encodeURIComponent(INTAKE_BUCKET)}`,
      {
        body: JSON.stringify({ limit: 100, offset: 0, prefix: "" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ),
    "Validator quarantine list",
  );

  const leasedSource = await authenticatedObjectRead(
    apiUrl,
    anonKey,
    tokens.noCircle,
    INTAKE_BUCKET,
    validationLease.source_object_path,
  );
  if (!leasedSource.ok || !leasedSource.body) {
    const body = await parseResponse(leasedSource);
    throw new Error(
      `Validator could not read its exact leased source (${leasedSource.status}, ${body?.error ?? "no error"}).`,
    );
  }

  let promotionStep = "validate source";
  let completedOriginalId;
  try {
    completedOriginalId = await withValidatedPhotoSpool(
      leasedSource.body,
      {
        expectedMimeType: validationLease.expected_mime_type,
        expectedSha256Hex: validationLease.expected_sha256_hex,
        expectedSizeBytes: Number(validationLease.expected_size_bytes),
      },
      async (validated) => {
        promotionStep = "upload canonical";
        const uploaded = await uploadValidatedOriginal(
          apiUrl,
          anonKey,
          tokens.noCircle,
          validationLease,
          validated.stream,
        );
        const uploadBody = await parseResponse(uploaded);
        if (!uploaded.ok) {
          throw new Error(
            `Canonical upload failed (${uploaded.status}, ${uploadBody?.error ?? "no error"}).`,
          );
        }
        cleanupEntries.push({
          bucket: ORIGINALS_BUCKET,
          objectPath: validationLease.canonical_object_path,
        });

        promotionStep = "deny canonical overwrite";
        const duplicateUpload = await uploadValidatedOriginal(
          apiUrl,
          anonKey,
          tokens.noCircle,
          validationLease,
          Buffer.from(syntheticOriginal),
        );
        const duplicateBody = await parseResponse(duplicateUpload);
        if (
          duplicateUpload.ok ||
          !/duplicate|already exists/iu.test(
            `${duplicateBody?.error ?? ""} ${duplicateBody?.message ?? ""}`,
          )
        ) {
          throw new Error("Canonical no-upsert collision did not fail closed.");
        }

        promotionStep = "read and verify canonical";
        const canonicalRead = await authenticatedObjectRead(
          apiUrl,
          anonKey,
          tokens.noCircle,
          ORIGINALS_BUCKET,
          validationLease.canonical_object_path,
        );
        if (!canonicalRead.ok || !canonicalRead.body) {
          throw new Error(
            "Validator could not re-read its canonical original.",
          );
        }
        const canonicalVerification = await validatePhotoByteStream(
          canonicalRead.body,
          {
            expectedMimeType: validated.mimeType,
            expectedSha256Hex: validated.sha256Hex,
            expectedSizeBytes: validated.sizeBytes,
          },
        );
        if (
          canonicalVerification.width !== validated.width ||
          canonicalVerification.height !== validated.height ||
          canonicalVerification.channels !== validated.channels ||
          canonicalVerification.pages !== validated.pages
        ) {
          throw new Error(
            "Canonical read-back changed decoded photo identity.",
          );
        }

        promotionStep = "inject late quarantine replacement";
        const lateQuarantineReplacement = await uploadObject(
          apiUrl,
          serviceKey,
          serviceKey,
          INTAKE_BUCKET,
          validationLease.source_object_path,
          lateQuarantineBytes,
          true,
        );
        const lateReplacementBody = await parseResponse(
          lateQuarantineReplacement,
        );
        if (!lateQuarantineReplacement.ok) {
          throw new Error(
            `The local late-write fault injection failed (${lateQuarantineReplacement.status}, ${lateReplacementBody?.error ?? "no error"}).`,
          );
        }

        promotionStep = "load canonical Storage evidence";
        const objectInfo = await authenticatedObjectInfo(
          apiUrl,
          anonKey,
          tokens.noCircle,
          ORIGINALS_BUCKET,
          validationLease.canonical_object_path,
        );
        if (
          !objectInfo.response.ok ||
          !uuidPattern.test(objectInfo.body?.id) ||
          typeof objectInfo.body?.version !== "string"
        ) {
          throw new Error("Canonical Storage evidence was unavailable.");
        }

        promotionStep = "atomically complete original";
        const completion = await rpcRequest(
          apiUrl,
          anonKey,
          tokens.noCircle,
          "complete_photo_validation",
          {
            lease_key: validationLeaseKey,
            storage_object_id: objectInfo.body.id,
            storage_object_version: objectInfo.body.version,
            validation_job_id: validationLease.validation_job_id,
            verified_channels: validated.channels,
            verified_height: validated.height,
            verified_mime_type: validated.mimeType,
            verified_pages: validated.pages,
            verified_sha256_hex: validated.sha256Hex,
            verified_size_bytes: validated.sizeBytes,
            verified_width: validated.width,
          },
        );
        if (!completion.response.ok || !uuidPattern.test(completion.body)) {
          throw new Error("Canonical original completion did not converge.");
        }
        return completion.body;
      },
    );
  } catch (error) {
    throw new Error(`Photo promotion failed during: ${promotionStep}.`, {
      cause: error,
    });
  }
  if (
    completedOriginalId !== validationLease.canonical_object_path.split("/")[1]
  ) {
    throw new Error("Canonical path and immutable original identity diverged.");
  }

  await assertObjectOperationsDenied(
    apiUrl,
    anonKey,
    tokens.noCircle,
    ORIGINALS_BUCKET,
    validationLease.canonical_object_path,
    "Completed validator original",
    cleanupEntries,
  );
  await assertObjectOperationsDenied(
    apiUrl,
    anonKey,
    tokens.organizerA,
    ORIGINALS_BUCKET,
    validationLease.canonical_object_path,
    "Completed family-browser original",
    cleanupEntries,
  );

  await expectRpcDenied(
    rpcRequest(
      apiUrl,
      anonKey,
      tokens.organizerA,
      "claim_photo_display_derivative",
      { lease_key: randomUUID(), original_id: completedOriginalId },
    ),
    "Family organizer derivative claim",
  );

  const derivativeLeaseKey = randomUUID();
  const derivativeLease = validateDerivativeLease(
    singleRpcRow(
      await rpcRequest(
        apiUrl,
        anonKey,
        tokens.noCircle,
        "claim_photo_display_derivative",
        {
          lease_key: derivativeLeaseKey,
          original_id: completedOriginalId,
        },
      ),
      "Display derivative lease",
    ),
    completedOriginalId,
  );
  if (
    Number(derivativeLease.source_size_bytes) !== syntheticOriginal.length ||
    derivativeLease.source_sha256_hex !== sha256Hex(syntheticOriginal)
  ) {
    throw new Error(
      "The derivative lease changed the immutable original fingerprint.",
    );
  }
  cleanupEntries.push({
    bucket: DISPLAY_BUCKET,
    objectPath: derivativeLease.display_object_path,
  });

  const derivativeSource = await authenticatedObjectRead(
    apiUrl,
    anonKey,
    tokens.noCircle,
    ORIGINALS_BUCKET,
    derivativeLease.source_object_path,
  );
  if (!derivativeSource.ok || !derivativeSource.body) {
    throw new Error(
      "The derivative validator could not read its exact immutable source.",
    );
  }

  let derivativeStep = "revalidate immutable source";
  let completedDerivativeId;
  let completedDerivativeEvidence;
  try {
    completedDerivativeId = await withValidatedPhotoSpool(
      derivativeSource.body,
      {
        expectedMimeType: derivativeLease.source_mime_type,
        expectedSha256Hex: derivativeLease.source_sha256_hex,
        expectedSizeBytes: Number(derivativeLease.source_size_bytes),
      },
      async (validated) => {
        if (
          validated.width !== Number(derivativeLease.source_width) ||
          validated.height !== Number(derivativeLease.source_height) ||
          validated.channels !== Number(derivativeLease.source_channels) ||
          validated.pages !== Number(derivativeLease.source_pages)
        ) {
          throw new Error(
            "The derivative source decode changed immutable geometry.",
          );
        }

        derivativeStep = "transform and upload display bytes";
        return withPhotoDisplayDerivative(validated, {}, async (derivative) => {
          await expectStorageWriteDenied(
            uploadValidatedDisplay(
              apiUrl,
              anonKey,
              tokens.noCircle,
              derivativeLease,
              derivative,
              Buffer.from("wrong display MIME"),
              "image/jpeg",
            ),
            "Non-WebP display upload",
          );
          await expectStorageWriteDenied(
            uploadValidatedDisplay(
              apiUrl,
              anonKey,
              tokens.noCircle,
              derivativeLease,
              derivative,
              Buffer.alloc(12 * 1024 * 1024 + 1),
            ),
            "Oversized display upload",
          );
          const uploaded = await uploadValidatedDisplay(
            apiUrl,
            anonKey,
            tokens.noCircle,
            derivativeLease,
            derivative,
            derivative.stream,
          );
          const uploadBody = await parseResponse(uploaded);
          if (!uploaded.ok) {
            throw new Error(
              `Display upload failed (${uploaded.status}, ${uploadBody?.error ?? "no error"}).`,
            );
          }

          derivativeStep = "deny display overwrite";
          const duplicate = await uploadValidatedDisplay(
            apiUrl,
            anonKey,
            tokens.noCircle,
            derivativeLease,
            derivative,
            Buffer.from("synthetic duplicate"),
          );
          const duplicateBody = await parseResponse(duplicate);
          if (
            duplicate.ok ||
            !/duplicate|already exists/iu.test(
              `${duplicateBody?.error ?? ""} ${duplicateBody?.message ?? ""}`,
            )
          ) {
            throw new Error("Display no-upsert collision did not fail closed.");
          }

          derivativeStep = "read and verify canonical display bytes";
          const canonicalRead = await authenticatedObjectRead(
            apiUrl,
            anonKey,
            tokens.noCircle,
            DISPLAY_BUCKET,
            derivativeLease.display_object_path,
          );
          if (!canonicalRead.ok || !canonicalRead.body) {
            throw new Error(
              "The validator could not re-read its canonical display object.",
            );
          }
          completedDerivativeEvidence = await validatePhotoDisplayByteStream(
            canonicalRead.body,
            {
              expectedChannels: derivative.channels,
              expectedHeight: derivative.height,
              expectedPages: derivative.pages,
              expectedSha256Hex: derivative.sha256Hex,
              expectedSizeBytes: derivative.sizeBytes,
              expectedWidth: derivative.width,
              transformVersion: PHOTO_DISPLAY_TRANSFORM_VERSION,
            },
          );

          derivativeStep = "load canonical display Storage evidence";
          const objectInfo = await authenticatedObjectInfo(
            apiUrl,
            anonKey,
            tokens.noCircle,
            DISPLAY_BUCKET,
            derivativeLease.display_object_path,
          );
          if (
            !objectInfo.response.ok ||
            !uuidPattern.test(objectInfo.body?.id) ||
            typeof objectInfo.body?.version !== "string"
          ) {
            throw new Error(
              "Canonical display Storage evidence was unavailable.",
            );
          }

          derivativeStep = "atomically complete display derivative";
          const completion = await rpcRequest(
            apiUrl,
            anonKey,
            tokens.noCircle,
            "complete_photo_display_derivative",
            {
              derivative_job_id: derivativeLease.derivative_job_id,
              lease_key: derivativeLeaseKey,
              output_channels: completedDerivativeEvidence.channels,
              output_height: completedDerivativeEvidence.height,
              output_pages: completedDerivativeEvidence.pages,
              output_sha256_hex: completedDerivativeEvidence.sha256Hex,
              output_size_bytes: completedDerivativeEvidence.sizeBytes,
              output_width: completedDerivativeEvidence.width,
              storage_object_id: objectInfo.body.id,
              storage_object_version: objectInfo.body.version,
            },
          );
          if (!completion.response.ok || !uuidPattern.test(completion.body)) {
            throw new Error("Canonical display completion did not converge.");
          }
          return completion.body;
        });
      },
    );
  } catch (error) {
    throw new Error(
      `Photo derivative generation failed during: ${derivativeStep}.`,
      { cause: error },
    );
  }
  if (
    completedDerivativeId !== derivativeLease.display_object_path.split("/")[1]
  ) {
    throw new Error(
      "Canonical display path and immutable derivative identity diverged.",
    );
  }

  for (const denied of [
    { label: "Completed validator display", token: tokens.noCircle },
    { label: "Completed organizer display", token: tokens.organizerA },
    { label: "Completed member display", token: tokens.memberA },
    { label: "Completed wrong-circle display", token: tokens.organizerB },
    { label: "Completed revoked-member display", token: tokens.revokedA },
    { label: "Completed anonymous display", token: null },
  ]) {
    await assertObjectOperationsDenied(
      apiUrl,
      anonKey,
      denied.token,
      DISPLAY_BUCKET,
      derivativeLease.display_object_path,
      denied.label,
      cleanupEntries,
    );
  }
  await assertObjectOperationsDenied(
    apiUrl,
    anonKey,
    tokens.noCircle,
    ORIGINALS_BUCKET,
    derivativeLease.source_object_path,
    "Post-derivative validator original",
    cleanupEntries,
  );
  runDatabaseAssertion(`
    do $assert_display_derivative$
    begin
      if not exists (
        select 1
          from private.photo_derivative_jobs as job
          join private.photo_display_derivatives as derivative
            on derivative.derivative_job_id = job.id
         where job.id = '${derivativeLease.derivative_job_id}'::uuid
           and job.state = 'verified'
           and derivative.id = '${completedDerivativeId}'::uuid
           and derivative.original_id = '${completedOriginalId}'::uuid
           and derivative.object_path = '${derivativeLease.display_object_path}'
           and encode(derivative.output_sha256, 'hex') =
             '${completedDerivativeEvidence.sha256Hex}'
           and derivative.output_pages = 1
           and derivative.transform_profile_version = 1
      ) or exists (
        select 1 from public.moments where kind = 'photo'
      ) then
        raise exception 'display derivative escaped its private immutable boundary';
      end if;
    end;
    $assert_display_derivative$;
  `);

  const collisionReservation = validateReservation(
    singleRpcRow(
      await reservePhoto(
        apiUrl,
        anonKey,
        tokens.organizerA,
        CIRCLE_A,
        PERSON_ORGANIZER_A,
        randomUUID(),
      ),
      "Canonical-collision reservation",
    ),
  );
  cleanupEntries.push({
    bucket: INTAKE_BUCKET,
    objectPath: collisionReservation.object_path,
  });
  const collisionUploadClaimResult = await claimPhotoUpload(
    apiUrl,
    anonKey,
    tokens.organizerA,
    collisionReservation.intake_id,
    syntheticOriginal,
  );
  const collisionUploadClaim = validateUploadClaim(
    singleRpcRow(
      collisionUploadClaimResult,
      "Canonical-collision upload claim",
    ),
    collisionReservation,
  );
  const collisionTusUpload = await uploadClaimedTus(
    apiUrl,
    anonKey,
    tokens.organizerA,
    collisionUploadClaim,
    syntheticOriginal,
    collisionUploadClaimResult.uploadMetadata,
  );
  if (!collisionTusUpload.creation.ok || !collisionTusUpload.patch?.ok) {
    throw new Error(
      `Canonical-collision TUS upload failed with ${collisionTusUpload.creation.status}/${collisionTusUpload.patch?.status ?? "no PATCH"}.`,
    );
  }
  const collisionAcknowledgement = singleRpcRow(
    await acknowledgePhoto(
      apiUrl,
      anonKey,
      tokens.organizerA,
      collisionReservation.intake_id,
    ),
    "Canonical-collision acknowledgement",
  );
  if (
    collisionAcknowledgement.intake_id !== collisionReservation.intake_id ||
    collisionAcknowledgement.object_path !== collisionReservation.object_path ||
    collisionAcknowledgement.state !== "uploaded_unverified" ||
    collisionAcknowledgement.observed_mime_type_unverified !== "image/jpeg" ||
    Number(collisionAcknowledgement.observed_size_bytes_unverified) !==
      syntheticOriginal.length
  ) {
    throw new Error(
      "Canonical-collision acknowledgement changed its quarantine evidence.",
    );
  }

  const collisionLeaseKey = randomUUID();
  const collisionLease = validateValidationLease(
    singleRpcRow(
      await rpcRequest(
        apiUrl,
        anonKey,
        tokens.noCircle,
        "claim_photo_validation",
        {
          intake_id: collisionReservation.intake_id,
          lease_key: collisionLeaseKey,
        },
      ),
      "Canonical-collision validation lease",
    ),
    collisionReservation,
  );
  const collisionSource = await authenticatedObjectRead(
    apiUrl,
    anonKey,
    tokens.noCircle,
    INTAKE_BUCKET,
    collisionLease.source_object_path,
  );
  if (!collisionSource.ok || !collisionSource.body) {
    throw new Error("Validator could not read the collision fixture source.");
  }
  const collisionSourceVerification = await validatePhotoByteStream(
    collisionSource.body,
    {
      expectedMimeType: collisionLease.expected_mime_type,
      expectedSha256Hex: collisionLease.expected_sha256_hex,
      expectedSizeBytes: Number(collisionLease.expected_size_bytes),
    },
  );

  const mismatchedCanonicalBytes = Buffer.from(syntheticOriginal);
  mismatchedCanonicalBytes[Math.floor(mismatchedCanonicalBytes.length / 2)] ^=
    0x01;
  if (
    mismatchedCanonicalBytes.length !== collisionSourceVerification.sizeBytes ||
    sha256Hex(mismatchedCanonicalBytes) ===
      collisionSourceVerification.sha256Hex
  ) {
    throw new Error(
      "Canonical-collision bytes were not an exact-size mismatch.",
    );
  }
  const seededCollision = await uploadObject(
    apiUrl,
    serviceKey,
    serviceKey,
    ORIGINALS_BUCKET,
    collisionLease.canonical_object_path,
    mismatchedCanonicalBytes,
  );
  const seededCollisionBody = await parseResponse(seededCollision);
  if (!seededCollision.ok) {
    throw new Error(
      `Trusted mismatched-canonical fixture creation failed (${seededCollision.status}, ${seededCollisionBody?.error ?? "no error"}).`,
    );
  }
  cleanupEntries.push({
    bucket: ORIGINALS_BUCKET,
    objectPath: collisionLease.canonical_object_path,
  });

  const collisionUpload = await uploadValidatedOriginal(
    apiUrl,
    anonKey,
    tokens.noCircle,
    collisionLease,
    Buffer.from(syntheticOriginal),
  );
  const collisionUploadBody = await parseResponse(collisionUpload);
  if (
    collisionUpload.ok ||
    !/duplicate|already exists/iu.test(
      `${collisionUploadBody?.error ?? ""} ${collisionUploadBody?.message ?? ""}`,
    )
  ) {
    throw new Error(
      "Mismatched canonical object did not stop the validator no-upsert upload.",
    );
  }

  const collisionCanonicalRead = await authenticatedObjectRead(
    apiUrl,
    anonKey,
    tokens.noCircle,
    ORIGINALS_BUCKET,
    collisionLease.canonical_object_path,
  );
  if (!collisionCanonicalRead.ok || !collisionCanonicalRead.body) {
    throw new Error(
      "Validator could not inspect the colliding canonical object.",
    );
  }
  let collisionMismatchCode;
  try {
    await validatePhotoByteStream(collisionCanonicalRead.body, {
      expectedMimeType: collisionSourceVerification.mimeType,
      expectedSha256Hex: collisionSourceVerification.sha256Hex,
      expectedSizeBytes: collisionSourceVerification.sizeBytes,
    });
  } catch (error) {
    collisionMismatchCode = error?.code;
  }
  if (collisionMismatchCode !== "PHOTO_HASH_MISMATCH") {
    throw new Error(
      `Colliding canonical bytes did not fail on the full-byte hash (${collisionMismatchCode ?? "no error"}).`,
    );
  }

  const collisionReview = await rpcRequest(
    apiUrl,
    anonKey,
    tokens.noCircle,
    "flag_photo_validation_for_review",
    {
      lease_key: collisionLeaseKey,
      review_reason: "canonical_collision",
      validation_job_id: collisionLease.validation_job_id,
    },
  );
  if (
    !collisionReview.response.ok ||
    collisionReview.body !== collisionLease.validation_job_id
  ) {
    throw new Error("Canonical collision did not enter operator review.");
  }
  await assertObjectOperationsDenied(
    apiUrl,
    anonKey,
    tokens.noCircle,
    ORIGINALS_BUCKET,
    collisionLease.canonical_object_path,
    "Operator-review colliding original",
    cleanupEntries,
  );
  runDatabaseAssertion(`
    do $assert_canonical_collision_review$
    begin
      if not exists (
        select 1
          from private.photo_intakes as intake
          join private.photo_validation_jobs as job
            on job.intake_id = intake.id
         where intake.id = '${collisionReservation.intake_id}'::uuid
           and intake.state = 'operator_review'
           and intake.validation_rejection_reason = 'canonical_collision'
           and job.id = '${collisionLease.validation_job_id}'::uuid
           and job.state = 'operator_review'
           and job.rejection_reason = 'canonical_collision'
           and job.completed_at is not null
      ) or exists (
        select 1
          from private.photo_originals
         where validation_job_id = '${collisionLease.validation_job_id}'::uuid
      ) or exists (
        select 1 from public.moments where kind = 'photo'
      ) then
        raise exception 'canonical collision escaped terminal operator review';
      end if;
    end;
    $assert_canonical_collision_review$;
  `);
  const retainedCollision = await storageRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    `object/${encodeURIComponent(ORIGINALS_BUCKET)}/${encodedObjectPath(collisionLease.canonical_object_path)}`,
  );
  const retainedCollisionBytes = Buffer.from(
    await retainedCollision.arrayBuffer(),
  );
  if (
    !retainedCollision.ok ||
    !retainedCollisionBytes.equals(mismatchedCanonicalBytes)
  ) {
    throw new Error(
      "Canonical collision review did not retain the exact quarantined mismatch.",
    );
  }

  const staleRequestKey = randomUUID();
  const staleReservation = validateReservation(
    singleRpcRow(
      await reservePhoto(
        apiUrl,
        anonKey,
        tokens.memberA,
        CIRCLE_A,
        PERSON_MEMBER_A,
        staleRequestKey,
      ),
      "Pre-revocation reservation",
    ),
  );
  cleanupEntries.push({
    bucket: INTAKE_BUCKET,
    objectPath: staleReservation.object_path,
  });
  const staleClaimResult = await claimPhotoUpload(
    apiUrl,
    anonKey,
    tokens.memberA,
    staleReservation.intake_id,
    syntheticOriginal,
  );
  validateUploadClaim(
    singleRpcRow(staleClaimResult, "Pre-revocation fingerprint claim"),
    staleReservation,
  );
  const staleTusCreation = await createResumableUpload(
    apiUrl,
    anonKey,
    tokens.memberA,
    INTAKE_BUCKET,
    staleReservation.object_path,
    syntheticOriginal.length,
    staleClaimResult.uploadMetadata,
  );
  if (!staleTusCreation.ok) {
    throw new Error(
      `Pre-revocation TUS creation failed with ${staleTusCreation.status}.`,
    );
  }
  const staleTusUrl = resumableUploadUrl(apiUrl, staleTusCreation);

  const revocation = await rpcRequest(
    apiUrl,
    anonKey,
    tokens.organizerATwo,
    "revoke_membership",
    { membership_id: MEMBER_A_MEMBERSHIP },
  );
  if (!revocation.response.ok) {
    throw new Error(
      `Fixture revocation failed with ${revocation.response.status}.`,
    );
  }

  await expectStorageWriteDenied(
    patchResumableUpload(
      anonKey,
      tokens.memberA,
      staleTusUrl,
      syntheticOriginal,
    ),
    "Revoked stale-token TUS part",
  );
  await expectStorageWriteDenied(
    createResumableUpload(
      apiUrl,
      anonKey,
      tokens.memberA,
      INTAKE_BUCKET,
      staleReservation.object_path,
      syntheticOriginal.length,
      staleClaimResult.uploadMetadata,
    ),
    "Revoked stale-token TUS creation",
  );
  await expectRpcDenied(
    reservePhoto(
      apiUrl,
      anonKey,
      tokens.memberA,
      CIRCLE_A,
      PERSON_MEMBER_A,
      randomUUID(),
    ),
    "Revoked stale-token reservation",
  );
  await expectReservationReplayUnusable(
    reservePhoto(
      apiUrl,
      anonKey,
      tokens.memberA,
      CIRCLE_A,
      PERSON_MEMBER_A,
      staleRequestKey,
    ),
    staleReservation,
    "Revoked request-key replay",
  );

  const closureAckRequestKey = randomUUID();
  const closureAckReservation = validateReservation(
    singleRpcRow(
      await reservePhoto(
        apiUrl,
        anonKey,
        tokens.dualCircle,
        CIRCLE_B,
        PERSON_DUAL_B,
        closureAckRequestKey,
      ),
      "Pre-closure reservation",
    ),
  );
  cleanupEntries.push({
    bucket: INTAKE_BUCKET,
    objectPath: closureAckReservation.object_path,
  });

  const closureUploadRequestKey = randomUUID();
  const closureUploadReservation = validateReservation(
    singleRpcRow(
      await reservePhoto(
        apiUrl,
        anonKey,
        tokens.dualCircle,
        CIRCLE_B,
        PERSON_DUAL_B,
        closureUploadRequestKey,
      ),
      "Second pre-closure reservation",
    ),
  );
  cleanupEntries.push({
    bucket: INTAKE_BUCKET,
    objectPath: closureUploadReservation.object_path,
  });

  const preClosureClaimResult = await claimPhotoUpload(
    apiUrl,
    anonKey,
    tokens.dualCircle,
    closureAckReservation.intake_id,
    syntheticOriginal,
  );
  validateUploadClaim(
    singleRpcRow(preClosureClaimResult, "Pre-closure fingerprint claim"),
    closureAckReservation,
  );
  const preClosureUpload = await uploadClaimedTus(
    apiUrl,
    anonKey,
    tokens.dualCircle,
    closureAckReservation,
    syntheticOriginal,
    preClosureClaimResult.uploadMetadata,
  );
  if (!preClosureUpload.creation.ok || !preClosureUpload.patch?.ok) {
    throw new Error(
      `Pre-closure claimed TUS upload failed with ${preClosureUpload.creation.status}/${preClosureUpload.patch?.status ?? "no PATCH"}.`,
    );
  }

  const closureRequest = await rpcRequest(
    apiUrl,
    anonKey,
    tokens.dualCircle,
    "request_account_closure",
    { request_key: randomUUID() },
  );
  if (
    !closureRequest.response.ok ||
    typeof closureRequest.body !== "string" ||
    !uuidPattern.test(closureRequest.body)
  ) {
    throw new Error(
      `Account-closure fixture setup failed with ${closureRequest.response.status}.`,
    );
  }

  await expectRpcDenied(
    reservePhoto(
      apiUrl,
      anonKey,
      tokens.dualCircle,
      CIRCLE_B,
      PERSON_DUAL_B,
      randomUUID(),
    ),
    "Closure-requested reservation",
  );
  await expectRpcDenied(
    claimPhotoUpload(
      apiUrl,
      anonKey,
      tokens.dualCircle,
      closureUploadReservation.intake_id,
      syntheticOriginal,
    ),
    "Closure-requested fingerprint claim",
  );
  await expectStorageWriteDenied(
    createResumableUpload(
      apiUrl,
      anonKey,
      tokens.dualCircle,
      INTAKE_BUCKET,
      closureUploadReservation.object_path,
      syntheticOriginal.length,
      photoUploadMetadata(
        closureUploadReservation.intake_id,
        randomUUID(),
        syntheticOriginal,
      ),
    ),
    "Closure-requested TUS creation",
  );
  await expectRpcDenied(
    acknowledgePhoto(
      apiUrl,
      anonKey,
      tokens.dualCircle,
      closureAckReservation.intake_id,
    ),
    "Closure-requested acknowledgement",
  );
  await expectReservationReplayUnusable(
    reservePhoto(
      apiUrl,
      anonKey,
      tokens.dualCircle,
      CIRCLE_B,
      PERSON_DUAL_B,
      closureAckRequestKey,
    ),
    closureAckReservation,
    "Closure-requested uploaded request-key replay",
  );
  await expectReservationReplayUnusable(
    reservePhoto(
      apiUrl,
      anonKey,
      tokens.dualCircle,
      CIRCLE_B,
      PERSON_DUAL_B,
      closureUploadRequestKey,
    ),
    closureUploadReservation,
    "Closure-requested reserved request-key replay",
  );

  // The SQL embeds only UUIDs and the migration-defined opaque path after strict
  // validation above. It deliberately checks quarantine metadata, not media bytes.
  runDatabaseAssertion(`
    do $assert_photo_intake$
    begin
      if not exists (
        select 1
          from private.photo_intakes as intake
          join storage.objects as object
            on object.bucket_id = '${INTAKE_BUCKET}'
           and object.name = intake.object_path
         where intake.id = '${firstReservation.intake_id}'::uuid
           and intake.circle_id = '${CIRCLE_A}'::uuid
           and intake.state = 'verified'
           and intake.object_path = '${firstReservation.object_path}'
           and object.owner_id = '${ORGANIZER_A}'
      ) then
        raise exception 'verified intake source-evidence invariant failed';
      end if;

      if not exists (
        select 1
          from private.photo_originals as original
          join private.photo_validation_jobs as job
            on job.id = original.validation_job_id
           and job.circle_id = original.circle_id
         where original.id = '${completedOriginalId}'::uuid
           and original.intake_id = '${firstReservation.intake_id}'::uuid
           and original.bucket_id = '${ORIGINALS_BUCKET}'
           and original.object_path = '${validationLease.canonical_object_path}'
           and encode(original.verified_sha256, 'hex') =
             '${sha256Hex(syntheticOriginal)}'
           and original.verified_size_bytes = ${syntheticOriginal.length}
           and job.state = 'verified'
      ) then
        raise exception 'immutable canonical-original invariant failed';
      end if;

      if exists (
        select 1
          from public.moments as moment
         where moment.kind = 'photo'
      ) then
        raise exception 'photo intake unexpectedly published a moment';
      end if;
    end;
    $assert_photo_intake$;
  `);

  // A service read proves denied browser DELETE/UPDATE operations did not remove
  // or replace the quarantined object. These are synthetic local bytes only.
  const retained = await storageRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    `object/${encodeURIComponent(INTAKE_BUCKET)}/${encodedObjectPath(firstReservation.object_path)}`,
  );
  const retainedBytes = Buffer.from(await retained.arrayBuffer());
  if (!retained.ok || !retainedBytes.equals(lateQuarantineBytes)) {
    throw new Error(
      "The late quarantine write was not isolated from canonical promotion.",
    );
  }

  const retainedOriginal = await storageRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    `object/${encodeURIComponent(ORIGINALS_BUCKET)}/${encodedObjectPath(validationLease.canonical_object_path)}`,
  );
  const retainedOriginalBytes = Buffer.from(
    await retainedOriginal.arrayBuffer(),
  );
  if (
    !retainedOriginal.ok ||
    !retainedOriginalBytes.equals(syntheticOriginal)
  ) {
    throw new Error("The canonical original was not retained byte-for-byte.");
  }

  process.stdout.write(
    "Local synthetic photo intake, isolated validation, exact-byte immutable original promotion, metadata-safe private display derivation with canonical read-back, mismatched-canonical operator review, and HTTP denial checks passed.\n",
  );
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  if (storageContext) {
    try {
      await cleanupObjects(
        storageContext.apiUrl,
        storageContext.serviceKey,
        storageContext.cleanupEntries,
      );
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      process.stderr.write(
        `Storage cleanup also failed after the integration error: ${cleanupError.message}\n`,
      );
    }
  }

  if (shouldRestoreFixtures) {
    try {
      resetDatabase();
    } catch (resetError) {
      if (!primaryError) throw resetError;
      process.stderr.write(
        `Fixture reset also failed after the integration error: ${resetError.message}\n`,
      );
    }
  }
}
