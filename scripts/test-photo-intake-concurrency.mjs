import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const supabaseBinary = fileURLToPath(
  new URL("../node_modules/.bin/supabase", import.meta.url),
);

const INTAKE_BUCKET = "our-days-intake";

const CIRCLE_A = "20000000-0000-4000-8000-000000000001";
const CIRCLE_B = "20000000-0000-4000-8000-000000000002";

const ORGANIZER_A = "10000000-0000-4000-8000-000000000001";
const ORGANIZER_A_TWO = "10000000-0000-4000-8000-000000000002";
const MEMBER_A = "10000000-0000-4000-8000-000000000003";
const DUAL_CIRCLE_USER = "10000000-0000-4000-8000-000000000005";
const ORGANIZER_B = "10000000-0000-4000-8000-000000000006";
const NO_CIRCLE_USER = "10000000-0000-4000-8000-000000000007";

const PERSON_ORGANIZER_A = "30000000-0000-4000-8000-000000000001";
const PERSON_MEMBER_A = "30000000-0000-4000-8000-000000000003";
const PERSON_DUAL_B = "30000000-0000-4000-8000-000000000007";
const MANAGED_CHILD_A = "30000000-0000-4000-8000-000000000008";
const PERSON_ORGANIZER_B = "30000000-0000-4000-8000-000000000006";

const ORGANIZER_A_MEMBERSHIP = "40000000-0000-4000-8000-000000000001";
const MEMBER_A_MEMBERSHIP = "40000000-0000-4000-8000-000000000003";
const DUAL_CIRCLE_A_MEMBERSHIP = "40000000-0000-4000-8000-000000000005";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const intakePathPattern =
  /^intake\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[0-9a-f]{64}$/u;

const syntheticPhoto = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff,
  0xd9,
]);
const competingPhotoA = Buffer.concat([
  syntheticPhoto.subarray(0, -2),
  Buffer.from([0x41, 0xff, 0xd9]),
]);
const competingPhotoB = Buffer.concat([
  syntheticPhoto.subarray(0, -2),
  Buffer.from([0x42, 0xff, 0xd9]),
]);

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

function runDatabaseQuery(sql) {
  try {
    execFileSync(supabaseBinary, ["db", "query", "--local", sql], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error.stdout?.toString().trim();
    throw new Error(
      `Local photo-intake concurrency assertion failed${detail ? `: ${detail}` : "."}`,
      { cause: error },
    );
  }
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createLocalUserToken(userId, jwtSecret, tokenId = randomUUID()) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    aud: "authenticated",
    exp: issuedAt + 3600,
    iat: issuedAt,
    iss: "supabase-demo",
    jti: tokenId,
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

function tusMetadataValue(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function createTusUpload(
  apiUrl,
  apiKey,
  token,
  objectPath,
  byteLength,
  uploadMetadata,
) {
  const response = await fetch(`${apiUrl}/storage/v1/upload/resumable`, {
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${token}`,
      "tus-resumable": "1.0.0",
      "upload-length": String(byteLength),
      "upload-metadata": [
        `bucketName ${tusMetadataValue(INTAKE_BUCKET)}`,
        `objectName ${tusMetadataValue(objectPath)}`,
        `contentType ${tusMetadataValue("image/jpeg")}`,
        `cacheControl ${tusMetadataValue("3600")}`,
        ...(uploadMetadata
          ? [`metadata ${tusMetadataValue(JSON.stringify(uploadMetadata))}`]
          : []),
      ].join(","),
      "x-upsert": "false",
    },
    method: "POST",
  });
  return { body: await parseResponse(response), response };
}

function tusUploadUrl(apiUrl, creation) {
  const location = creation.response.headers.get("location");
  if (!location) throw new Error("TUS creation omitted its Location header.");
  const url = new URL(location, `${apiUrl}/storage/v1/upload/resumable`);
  if (url.origin !== new URL(apiUrl).origin) {
    throw new Error("TUS creation returned an unexpected origin.");
  }
  return url.toString();
}

async function patchTusUpload(apiKey, token, uploadUrl, bytes) {
  const response = await fetch(uploadUrl, {
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
  return { body: await parseResponse(response), response };
}

async function uploadClaimedTus(
  apiUrl,
  apiKey,
  token,
  objectPath,
  bytes,
  uploadMetadata,
) {
  const creation = await createTusUpload(
    apiUrl,
    apiKey,
    token,
    objectPath,
    bytes.length,
    uploadMetadata,
  );
  if (!creation.response.ok) return { creation, patch: null };
  const patch = await patchTusUpload(
    apiKey,
    token,
    tusUploadUrl(apiUrl, creation),
    bytes,
  );
  return { creation, patch };
}

async function readObject(apiUrl, serviceKey, objectPath) {
  const response = await fetch(
    `${apiUrl}/storage/v1/object/${encodeURIComponent(INTAKE_BUCKET)}/${encodedObjectPath(objectPath)}`,
    {
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
      },
    },
  );

  return { bytes: Buffer.from(await response.arrayBuffer()), response };
}

async function assertAcceptedPatchBytes(
  apiUrl,
  serviceKey,
  patch,
  objectPath,
  expectedBytes,
  label,
) {
  if (!patch.response.ok) return;
  const retained = await readObject(apiUrl, serviceKey, objectPath);
  if (!retained.response.ok || !retained.bytes.equals(expectedBytes)) {
    throw new Error(`${label} did not retain exactly the accepted bytes.`);
  }
}

async function deleteObjects(apiUrl, serviceKey, objectPaths) {
  if (objectPaths.length === 0) return;

  const exactPaths = [...new Set(objectPaths)];

  const result = await jsonRequest(
    `${apiUrl}/storage/v1/object/${encodeURIComponent(INTAKE_BUCKET)}`,
    serviceKey,
    serviceKey,
    {
      body: JSON.stringify({ prefixes: exactPaths }),
      method: "DELETE",
    },
  );

  if (!result.response.ok) {
    throw new Error(
      `Exact quarantine cleanup failed with ${result.response.status}.`,
    );
  }

  for (const objectPath of exactPaths) {
    const retained = await readObject(apiUrl, serviceKey, objectPath);
    if (retained.response.ok) {
      throw new Error("Quarantine object remained after exact cleanup.");
    }
    requireSafeDenied(retained, "Quarantine cleanup read-back");
  }
}

function requireSuccess(result, label) {
  if (!result.response.ok) {
    throw new Error(
      `${label} failed with ${result.response.status} (${result.body?.code ?? "no code"}).`,
    );
  }
  return result.body;
}

function requireSafeStorageOutcome(result, label) {
  if (result.response.ok) return true;
  if (
    result.response.status >= 500 ||
    result.body?.code === "40P01" ||
    result.body?.error === "40P01"
  ) {
    throw new Error(
      `${label} did not use a safe serial outcome (${result.response.status}, ${result.body?.code ?? result.body?.error ?? "no code"}).`,
    );
  }
  return false;
}

function requireSafeDenied(result, label) {
  if (result.response.ok) {
    throw new Error(`${label} unexpectedly succeeded.`);
  }
  if (
    result.response.status >= 500 ||
    result.body?.code === "40P01" ||
    result.body?.error === "40P01"
  ) {
    throw new Error(
      `${label} did not use a safe denial (${result.response.status}, ${result.body?.code ?? result.body?.error ?? "no code"}).`,
    );
  }
}

function reservationRow(result, label) {
  const row = Array.isArray(result.body) ? result.body[0] : result.body;
  if (
    !result.response.ok ||
    !row ||
    !uuidPattern.test(row.intake_id) ||
    row.bucket_id !== INTAKE_BUCKET ||
    !intakePathPattern.test(row.object_path) ||
    row.object_path !== `intake/${row.intake_id}` ||
    row.state !== "reserved" ||
    typeof row.expires_at !== "string"
  ) {
    throw new Error(
      `${label} returned an invalid reservation contract (${result.response.status}, ${JSON.stringify(result.body)}).`,
    );
  }
  return row;
}

function uploadClaimRow(result, reservation, label) {
  const row = Array.isArray(result.body) ? result.body[0] : result.body;
  if (
    !result.response.ok ||
    !row ||
    row.intake_id !== reservation.intake_id ||
    row.bucket_id !== INTAKE_BUCKET ||
    row.object_path !== reservation.object_path ||
    row.state !== "upload_claimed" ||
    typeof row.upload_expires_at !== "string"
  ) {
    throw new Error(`${label} returned an invalid upload-claim contract.`);
  }
  return row;
}

function acknowledgementRow(result, reservation, expectedSize, label) {
  const row = Array.isArray(result.body) ? result.body[0] : result.body;
  if (
    !result.response.ok ||
    !row ||
    row.intake_id !== reservation.intake_id ||
    row.bucket_id !== INTAKE_BUCKET ||
    row.object_path !== reservation.object_path ||
    row.state !== "uploaded_unverified" ||
    typeof row.expires_at !== "string" ||
    row.observed_mime_type_unverified !== "image/jpeg" ||
    Number(row.observed_size_bytes_unverified) !== expectedSize
  ) {
    throw new Error(`${label} returned an invalid acknowledgement contract.`);
  }
  return row;
}

function validationLeaseRow(result, reservation, label) {
  const row = Array.isArray(result.body) ? result.body[0] : result.body;
  const canonicalPathParts = row?.canonical_object_path?.split("/") ?? [];
  if (
    !result.response.ok ||
    !row ||
    !uuidPattern.test(row.validation_job_id) ||
    !uuidPattern.test(row.lease_attempt_id) ||
    row.intake_id !== reservation.intake_id ||
    row.source_bucket_id !== INTAKE_BUCKET ||
    row.source_object_path !== reservation.object_path ||
    !uuidPattern.test(row.source_storage_object_id) ||
    row.canonical_bucket_id !== "our-days-originals" ||
    canonicalPathParts.length !== 3 ||
    canonicalPathParts[0] !== "original" ||
    !uuidPattern.test(canonicalPathParts[1]) ||
    canonicalPathParts[2] !== row.lease_attempt_id ||
    row.expected_mime_type !== "image/jpeg" ||
    !sha256Pattern.test(row.expected_sha256_hex) ||
    typeof row.lease_expires_at !== "string"
  ) {
    throw new Error(`${label} returned an invalid validation-lease contract.`);
  }
  return row;
}

async function completePhotoValidation(
  apiUrl,
  apiKey,
  token,
  lease,
  leaseKey,
  storageObjectId,
) {
  return rpcRequest(apiUrl, apiKey, token, "complete_photo_validation", {
    lease_key: leaseKey,
    storage_object_id: storageObjectId,
    storage_object_version: "",
    validation_job_id: lease.validation_job_id,
    verified_channels: 3,
    verified_height: 2,
    verified_mime_type: lease.expected_mime_type,
    verified_pages: 1,
    verified_sha256_hex: lease.expected_sha256_hex,
    verified_size_bytes: Number(lease.expected_size_bytes),
    verified_width: 2,
  });
}

async function reservePhoto(
  apiUrl,
  apiKey,
  token,
  circleId,
  journalPersonId,
  requestKey,
) {
  return rpcRequest(apiUrl, apiKey, token, "reserve_photo_intake", {
    circle_id: circleId,
    journal_person_id: journalPersonId,
    request_key: requestKey,
  });
}

async function reservePhotoMoment(
  apiUrl,
  apiKey,
  token,
  circleId,
  journalPersonId,
  requestKey,
) {
  return rpcRequest(apiUrl, apiKey, token, "reserve_photo_moment", {
    body: "A concurrency-safe photo moment.",
    circle_id: circleId,
    journal_person_id: journalPersonId,
    occurred_at: null,
    occurred_on: "2026-08-30",
    occurred_timezone: null,
    place_name: null,
    request_key: requestKey,
    tagged_person_ids: [],
  });
}

async function claimPhotoUpload(
  apiUrl,
  apiKey,
  token,
  intakeId,
  bytes,
  uploadRequestKey = randomUUID(),
) {
  const uploadMetadata = photoUploadMetadata(intakeId, uploadRequestKey, bytes);
  if (!sha256Pattern.test(uploadMetadata.expected_sha256)) {
    throw new Error("Synthetic upload digest was not canonical SHA-256.");
  }
  const result = await rpcRequest(
    apiUrl,
    apiKey,
    token,
    "claim_photo_intake_upload",
    {
      expected_mime_type: "image/jpeg",
      expected_sha256_hex: uploadMetadata.expected_sha256,
      expected_size_bytes: bytes.length,
      intake_id: intakeId,
      upload_request_key: uploadRequestKey,
    },
  );
  return { ...result, uploadMetadata };
}

async function acknowledgePhoto(apiUrl, apiKey, token, intakeId) {
  return rpcRequest(apiUrl, apiKey, token, "acknowledge_photo_intake", {
    intake_id: intakeId,
  });
}

async function waitForConcurrencyProbe({
  apiUrl,
  expectedWaiters,
  label,
  operationNames = [],
  requireSleep = false,
  serviceKey,
  timeoutMs = 3500,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus;

  while (Date.now() < deadline) {
    const probe = await rpcRequest(
      apiUrl,
      serviceKey,
      serviceKey,
      "phase4a_test_concurrency_probe",
      {
        expected_waiters: expectedWaiters,
        operation_names: operationNames,
        require_sleep: requireSleep,
      },
    );
    lastStatus = probe.response.status;
    if (probe.response.ok && probe.body === true) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  throw new Error(
    `${label} was not observed before timeout (last probe status ${lastStatus ?? "none"}).`,
  );
}

async function runHeldRace({
  apiUrl,
  expectedContenders,
  holderBody,
  holderFunction,
  label,
  requests,
  serviceKey,
}) {
  const holderPromise = rpcRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    holderFunction,
    { ...holderBody, hold_ms: 5000 },
  );

  await waitForConcurrencyProbe({
    apiUrl,
    expectedWaiters: 1,
    label: `${label} lock holder`,
    operationNames: [holderFunction],
    requireSleep: true,
    serviceKey,
  });

  const racingPromises = requests.map((startRequest) => startRequest());
  try {
    await waitForConcurrencyProbe({
      apiUrl,
      expectedWaiters: expectedContenders ?? requests.length,
      label: `${label} contenders`,
      serviceKey,
    });
  } catch (error) {
    await Promise.allSettled([holderPromise, ...racingPromises]);
    throw error;
  }

  const [holder, outcomes] = await Promise.all([
    holderPromise,
    Promise.all(racingPromises),
  ]);
  requireSuccess(holder, `${label} lock holder`);
  return outcomes;
}

function assertDuplicateReservation(first, second, requestKey) {
  for (const key of [
    "intake_id",
    "bucket_id",
    "object_path",
    "state",
    "expires_at",
  ]) {
    if (first[key] !== second[key]) {
      throw new Error("Concurrent duplicate reservations did not converge.");
    }
  }

  runDatabaseQuery(`
    do $assert_duplicate_reservation$
    begin
      if (
        select count(*)
          from private.photo_intakes
         where requested_by_membership_id =
             '40000000-0000-4000-8000-000000000006'::uuid
           and request_key = '${requestKey}'::uuid
      ) <> 1 then
        raise exception 'duplicate reservation created multiple ledger rows';
      end if;
    end
    $assert_duplicate_reservation$;
  `);
}

function assertIntakeInvalidated(intake, reason, expectedOwnerId) {
  if (
    !uuidPattern.test(intake.intake_id) ||
    !intakePathPattern.test(intake.object_path)
  ) {
    throw new Error("Refusing to interpolate an invalid intake identity.");
  }
  if (!uuidPattern.test(expectedOwnerId)) {
    throw new Error("Refusing to interpolate an invalid expected owner.");
  }
  if (
    reason !== "membership_authority_changed" &&
    reason !== "guardian_authority_revoked"
  ) {
    throw new Error("Refusing to interpolate an invalid invalidation reason.");
  }

  runDatabaseQuery(`
    do $assert_invalidated_intake$
    begin
      if not exists (
        select 1
          from private.photo_intakes as intake
         where intake.id = '${intake.intake_id}'::uuid
           and intake.object_path = '${intake.object_path}'
           and intake.state = 'invalidated'
           and intake.invalidated_at is not null
           and intake.invalidation_reason = '${reason}'
           and not private.photo_intake_requester_is_authorized(intake.id)
      ) then
        raise exception 'photo intake was not terminalized after authority loss';
      end if;

      if (
        select count(*)
          from storage.objects as object
         where object.bucket_id = '${INTAKE_BUCKET}'
           and object.name = '${intake.object_path}'
           and object.owner_id is distinct from '${expectedOwnerId}'
      ) <> 0 then
        raise exception 'quarantine object has an unexpected owner';
      end if;
    end
    $assert_invalidated_intake$;
  `);
}

function assertClosureRequestedButUnauthorized(intakes, closureRequestId) {
  if (!uuidPattern.test(closureRequestId)) {
    throw new Error("Account closure returned an invalid identifier.");
  }

  const intakeIds = intakes
    .map((intake) => `'${intake.intake_id}'::uuid`)
    .join(", ");
  runDatabaseQuery(`
    do $assert_closure_blocking$
    begin
      if not exists (
        select 1
          from private.account_closure_requests
         where id = '${closureRequestId}'::uuid
           and auth_user_id = '${DUAL_CIRCLE_USER}'::uuid
           and state = 'requested'
      ) or exists (
        select 1
          from private.photo_intakes as intake
         where intake.id in (${intakeIds})
           and private.photo_intake_requester_is_authorized(intake.id)
      ) then
        raise exception 'closure request did not immediately close intake authority';
      end if;
    end
    $assert_closure_blocking$;
  `);
}

function assertClosurePrepared(closureRequestId, intakes) {
  const intakeIds = intakes
    .map((intake) => `'${intake.intake_id}'::uuid`)
    .join(", ");
  runDatabaseQuery(`
    do $assert_closure_prepared$
    begin
      if not exists (
        select 1
          from private.account_closure_requests
         where id = '${closureRequestId}'::uuid
           and auth_user_id = '${DUAL_CIRCLE_USER}'::uuid
           and state = 'prepared'
           and prepared_at is not null
      ) or exists (
        select 1
          from public.circle_memberships
         where user_id = '${DUAL_CIRCLE_USER}'::uuid
      ) or (
        select count(*)
          from private.photo_intakes
         where id in (${intakeIds})
           and state = 'invalidated'
           and invalidation_reason = 'account_closure_requested'
           and invalidated_at is not null
      ) <> ${intakes.length} then
        raise exception 'closure preparation left live or partial photo intake state';
      end if;
    end
    $assert_closure_prepared$;
  `);
}

async function assertPostLossCapabilityClosed({
  apiKey,
  apiUrl,
  canary,
  label,
  reserveArgs,
  target,
  token,
  uploadMetadata,
}) {
  requireSafeDenied(
    await claimPhotoUpload(
      apiUrl,
      apiKey,
      token,
      canary.intake_id,
      syntheticPhoto,
    ),
    `${label} fresh fingerprint claim`,
  );
  requireSafeDenied(
    await createTusUpload(
      apiUrl,
      apiKey,
      token,
      target.object_path,
      syntheticPhoto.length,
      uploadMetadata,
    ),
    `${label} TUS creation`,
  );
  requireSafeDenied(
    await acknowledgePhoto(apiUrl, apiKey, token, target.intake_id),
    `${label} acknowledgement`,
  );
  requireSafeDenied(
    await reservePhoto(apiUrl, apiKey, token, ...reserveArgs, randomUUID()),
    `${label} new reservation`,
  );
}

function installTestHelpers() {
  runDatabaseQuery(`
    do $install$
    begin
      execute $definition$
        create function public.phase4a_test_hold_auth_user_lock(
          target_auth_user_id uuid,
          hold_ms integer
        )
        returns void
        language plpgsql
        volatile
        security definer
        set search_path = ''
        as $body$
        begin
          if hold_ms not between 1 and 15000
            or not exists (
              select 1
                from auth.users
               where id = target_auth_user_id
                 and email like '%@example.test'
            ) then
            raise exception using
              errcode = '42501',
              message = 'Test lock unavailable';
          end if;

          perform 1
            from auth.users
           where id = target_auth_user_id
           for update;
          perform pg_catalog.pg_sleep(hold_ms::double precision / 1000);
        end
        $body$
      $definition$;

      execute $definition$
        create function public.phase4a_test_hold_circle_lock(
          target_circle_id uuid,
          hold_ms integer
        )
        returns void
        language plpgsql
        volatile
        security definer
        set search_path = ''
        as $body$
        begin
          if hold_ms not between 1 and 15000
            or target_circle_id not in (
              '20000000-0000-4000-8000-000000000001'::uuid,
              '20000000-0000-4000-8000-000000000002'::uuid
            ) then
            raise exception using
              errcode = '42501',
              message = 'Test lock unavailable';
          end if;

          perform 1
            from public.circles
           where id = target_circle_id
           for update;
          perform pg_catalog.pg_sleep(hold_ms::double precision / 1000);
        end
        $body$
      $definition$;

      execute $definition$
        create function public.phase4a_test_concurrency_probe(
          operation_names text[],
          expected_waiters integer,
          require_sleep boolean
        )
        returns boolean
        language sql
        stable
        security definer
        set search_path = ''
        as $body$
          select count(*) >= expected_waiters
            from pg_catalog.pg_stat_activity as activity
           where activity.pid <> pg_catalog.pg_backend_pid()
             and activity.state = 'active'
             and (
               pg_catalog.cardinality(operation_names) = 0
               or exists (
                 select 1
                   from pg_catalog.unnest(operation_names) as operation_name
                  where pg_catalog.strpos(
                    pg_catalog.lower(activity.query),
                    pg_catalog.lower(operation_name)
                  ) > 0
               )
             )
             and case
               when require_sleep then activity.wait_event = 'PgSleep'
               else activity.wait_event_type = 'Lock'
             end;
        $body$
      $definition$;

      execute $definition$
        create function public.phase4a_test_prepare_account_closure(
          closure_request_id uuid
        )
        returns uuid
        language sql
        volatile
        security definer
        set search_path = ''
        as $body$
          select private.prepare_account_closure(closure_request_id);
        $body$
      $definition$;

      execute $definition$
        create function public.phase4b_test_revoke_validator_and_hold(
          target_auth_user_id uuid,
          hold_ms integer
        )
        returns void
        language plpgsql
        volatile
        security definer
        set search_path = ''
        as $body$
        begin
          if hold_ms not between 1 and 15000
            or target_auth_user_id <>
              '10000000-0000-4000-8000-000000000007'::uuid then
            raise exception using
              errcode = '42501',
              message = 'Test validator revocation unavailable';
          end if;

          update private.photo_validator_allowlist as validator
             set revoked_at = statement_timestamp()
           where validator.auth_user_id = target_auth_user_id
             and validator.revoked_at is null;
          if not found then
            raise exception using
              errcode = '42501',
              message = 'Test validator revocation unavailable';
          end if;

          perform pg_catalog.pg_sleep(hold_ms::double precision / 1000);
        end
        $body$
      $definition$;

      execute 'revoke all on function public.phase4a_test_hold_auth_user_lock(uuid, integer) from public, anon, authenticated';
      execute 'revoke all on function public.phase4a_test_hold_circle_lock(uuid, integer) from public, anon, authenticated';
      execute 'revoke all on function public.phase4a_test_concurrency_probe(text[], integer, boolean) from public, anon, authenticated';
      execute 'revoke all on function public.phase4a_test_prepare_account_closure(uuid) from public, anon, authenticated';
      execute 'revoke all on function public.phase4b_test_revoke_validator_and_hold(uuid, integer) from public, anon, authenticated';
      execute 'grant execute on function public.phase4a_test_hold_auth_user_lock(uuid, integer) to service_role';
      execute 'grant execute on function public.phase4a_test_hold_circle_lock(uuid, integer) to service_role';
      execute 'grant execute on function public.phase4a_test_concurrency_probe(text[], integer, boolean) to service_role';
      execute 'grant execute on function public.phase4a_test_prepare_account_closure(uuid) to service_role';
      execute 'grant execute on function public.phase4b_test_revoke_validator_and_hold(uuid, integer) to service_role';
    end
    $install$;
  `);
}

let cleanupPaths = [];
let localStatus;
let primaryError;
let shouldRestoreFixtures = false;

try {
  localStatus = await readLocalStatus();
  const apiUrl = localStatus.API_URL;
  const apiKey = localStatus.ANON_KEY ?? localStatus.PUBLISHABLE_KEY;
  const serviceKey = localStatus.SERVICE_ROLE_KEY ?? localStatus.SECRET_KEY;
  const jwtSecret = localStatus.JWT_SECRET;

  if (!apiUrl || !apiKey || !serviceKey || !jwtSecret) {
    throw new Error(
      "Local Supabase status did not include the required test values.",
    );
  }

  resetDatabase();
  await waitForDatabaseReady();
  shouldRestoreFixtures = true;
  installTestHelpers();
  runDatabaseQuery(`
    insert into auth.sessions (
      id, user_id, created_at, updated_at, not_after
    )
    select auth_user.id, auth_user.id, statement_timestamp(),
      statement_timestamp(), statement_timestamp() + interval '1 day'
      from auth.users as auth_user
    on conflict (id) do nothing;
  `);
  runDatabaseQuery(`
    update private.photo_capabilities
       set enabled = true,
           updated_at = statement_timestamp()
     where capability = 'photo_publication';
  `);

  await waitForConcurrencyProbe({
    apiUrl,
    expectedWaiters: 0,
    label: "Photo-intake concurrency probe schema cache",
    operationNames: ["phase4a-schema-ready"],
    serviceKey,
  });

  const tokens = {
    dualCircle: createLocalUserToken(DUAL_CIRCLE_USER, jwtSecret),
    memberA: createLocalUserToken(MEMBER_A, jwtSecret),
    organizerA: createLocalUserToken(ORGANIZER_A, jwtSecret),
    organizerATwo: createLocalUserToken(ORGANIZER_A_TWO, jwtSecret),
    organizerB: createLocalUserToken(ORGANIZER_B, jwtSecret),
    noCircle: createLocalUserToken(NO_CIRCLE_USER, jwtSecret),
  };

  const duplicateRequestKey = randomUUID();
  const duplicateOutcomes = await runHeldRace({
    apiUrl,
    holderBody: { target_auth_user_id: ORGANIZER_B },
    holderFunction: "phase4a_test_hold_auth_user_lock",
    label: "duplicate reservation",
    requests: [
      () =>
        reservePhoto(
          apiUrl,
          apiKey,
          tokens.organizerB,
          CIRCLE_B,
          PERSON_ORGANIZER_B,
          duplicateRequestKey,
        ),
      () =>
        reservePhoto(
          apiUrl,
          apiKey,
          tokens.organizerB,
          CIRCLE_B,
          PERSON_ORGANIZER_B,
          duplicateRequestKey,
        ),
    ],
    serviceKey,
  });
  const duplicateReservations = duplicateOutcomes.map((outcome, index) =>
    reservationRow(outcome, `Concurrent duplicate reservation ${index + 1}`),
  );
  cleanupPaths.push(duplicateReservations[0].object_path);
  assertDuplicateReservation(
    duplicateReservations[0],
    duplicateReservations[1],
    duplicateRequestKey,
  );

  const claimRaceReservation = reservationRow(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.organizerB,
      CIRCLE_B,
      PERSON_ORGANIZER_B,
      randomUUID(),
    ),
    "Upload-claim collision reservation",
  );
  cleanupPaths.push(claimRaceReservation.object_path);

  const claimRaceBytes = [competingPhotoA, competingPhotoB];
  const claimRaceKeys = [randomUUID(), randomUUID()];
  const claimRaceOutcomes = await runHeldRace({
    apiUrl,
    holderBody: { target_auth_user_id: ORGANIZER_B },
    holderFunction: "phase4a_test_hold_auth_user_lock",
    label: "different fingerprint upload claims",
    requests: claimRaceBytes.map(
      (bytes, index) => () =>
        claimPhotoUpload(
          apiUrl,
          apiKey,
          tokens.organizerB,
          claimRaceReservation.intake_id,
          bytes,
          claimRaceKeys[index],
        ),
    ),
    serviceKey,
  });
  const claimRaceWinners = claimRaceOutcomes
    .map((outcome, index) => ({
      bytes: claimRaceBytes[index],
      key: claimRaceKeys[index],
      outcome,
    }))
    .filter(({ outcome }) => outcome.response.ok);
  const claimRaceLosers = claimRaceOutcomes.filter(
    (outcome) => !outcome.response.ok,
  );
  if (claimRaceWinners.length !== 1 || claimRaceLosers.length !== 1) {
    throw new Error(
      `Fingerprint claim race did not select exactly one winner (${claimRaceOutcomes
        .map((outcome) => outcome.response.status)
        .join(", ")}).`,
    );
  }
  uploadClaimRow(
    claimRaceWinners[0].outcome,
    claimRaceReservation,
    "Fingerprint claim race winner",
  );
  requireSafeDenied(claimRaceLosers[0], "Fingerprint claim race loser");
  runDatabaseQuery(`
    do $assert_claim_winner$
    begin
      if not exists (
        select 1
          from private.photo_intakes
         where id = '${claimRaceReservation.intake_id}'::uuid
           and upload_request_key = '${claimRaceWinners[0].key}'::uuid
           and expected_size_bytes = ${claimRaceWinners[0].bytes.length}
           and encode(expected_sha256, 'hex') =
             '${sha256Hex(claimRaceWinners[0].bytes)}'
           and state = 'upload_claimed'
      ) then
        raise exception 'claim race did not persist the winning fingerprint';
      end if;
    end
    $assert_claim_winner$;
  `);

  const claimRaceUpload = await uploadClaimedTus(
    apiUrl,
    apiKey,
    tokens.organizerB,
    claimRaceReservation.object_path,
    claimRaceWinners[0].bytes,
    claimRaceWinners[0].outcome.uploadMetadata,
  );
  requireSuccess(claimRaceUpload.creation, "Winning claim TUS creation");
  requireSuccess(claimRaceUpload.patch, "Winning claim TUS patch");
  const retainedClaimRaceObject = await readObject(
    apiUrl,
    serviceKey,
    claimRaceReservation.object_path,
  );
  if (
    !retainedClaimRaceObject.response.ok ||
    !retainedClaimRaceObject.bytes.equals(claimRaceWinners[0].bytes)
  ) {
    throw new Error(
      "Fingerprint claim race did not retain exactly the winner's bytes.",
    );
  }
  acknowledgementRow(
    await acknowledgePhoto(
      apiUrl,
      apiKey,
      tokens.organizerB,
      claimRaceReservation.intake_id,
    ),
    claimRaceReservation,
    claimRaceWinners[0].bytes.length,
    "Winning claim acknowledgement",
  );

  const sameUrlReservation = reservationRow(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.organizerB,
      CIRCLE_B,
      PERSON_ORGANIZER_B,
      randomUUID(),
    ),
    "Same-URL TUS reservation",
  );
  cleanupPaths.push(sameUrlReservation.object_path);
  const sameUrlClaim = await claimPhotoUpload(
    apiUrl,
    apiKey,
    tokens.organizerB,
    sameUrlReservation.intake_id,
    competingPhotoA,
  );
  uploadClaimRow(sameUrlClaim, sameUrlReservation, "Same-URL TUS claim");
  const sameUrlCreation = await createTusUpload(
    apiUrl,
    apiKey,
    tokens.organizerB,
    sameUrlReservation.object_path,
    competingPhotoA.length,
    sameUrlClaim.uploadMetadata,
  );
  requireSuccess(sameUrlCreation, "Same-URL TUS creation");
  const sharedUploadUrl = tusUploadUrl(apiUrl, sameUrlCreation);
  const sameUrlPatches = await Promise.all(
    [competingPhotoA, competingPhotoB].map((bytes) =>
      patchTusUpload(apiKey, tokens.organizerB, sharedUploadUrl, bytes),
    ),
  );
  const sameUrlPatchWinners = sameUrlPatches
    .map((patch, index) => ({
      bytes: [competingPhotoA, competingPhotoB][index],
      patch,
    }))
    .filter(({ patch }) => patch.response.ok);
  const sameUrlPatchLosers = sameUrlPatches.filter(
    (patch) => !patch.response.ok,
  );
  if (sameUrlPatchWinners.length !== 1 || sameUrlPatchLosers.length !== 1) {
    throw new Error(
      `Same-URL TUS race did not select exactly one completion (${sameUrlPatches
        .map((patch) => patch.response.status)
        .join(", ")}).`,
    );
  }
  requireSafeDenied(sameUrlPatchLosers[0], "Same-URL TUS losing patch");
  const retainedSameUrlObject = await readObject(
    apiUrl,
    serviceKey,
    sameUrlReservation.object_path,
  );
  if (
    !retainedSameUrlObject.response.ok ||
    !retainedSameUrlObject.bytes.equals(sameUrlPatchWinners[0].bytes)
  ) {
    throw new Error("Same-URL TUS race did not retain its one winning patch.");
  }
  acknowledgementRow(
    await acknowledgePhoto(
      apiUrl,
      apiKey,
      tokens.organizerB,
      sameUrlReservation.intake_id,
    ),
    sameUrlReservation,
    retainedSameUrlObject.bytes.length,
    "Same-URL TUS acknowledgement",
  );

  const dualTusReservation = reservationRow(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.organizerB,
      CIRCLE_B,
      PERSON_ORGANIZER_B,
      randomUUID(),
    ),
    "Adversarial dual-TUS reservation",
  );
  cleanupPaths.push(dualTusReservation.object_path);
  const dualTusClaim = await claimPhotoUpload(
    apiUrl,
    apiKey,
    tokens.organizerB,
    dualTusReservation.intake_id,
    competingPhotoA,
  );
  uploadClaimRow(
    dualTusClaim,
    dualTusReservation,
    "Adversarial dual-TUS claim",
  );

  const dualTusCreations = await Promise.all(
    [competingPhotoA, competingPhotoB].map((bytes) =>
      createTusUpload(
        apiUrl,
        apiKey,
        tokens.organizerB,
        dualTusReservation.object_path,
        bytes.length,
        dualTusClaim.uploadMetadata,
      ),
    ),
  );
  if (dualTusCreations.some((creation) => !creation.response.ok)) {
    throw new Error(
      `Pinned distinct-URL TUS creation behavior changed (${dualTusCreations
        .map((creation) => creation.response.status)
        .join(", ")}).`,
    );
  }

  const dualTusPatches = await Promise.all(
    dualTusCreations.map((creation, index) =>
      patchTusUpload(
        apiKey,
        tokens.organizerB,
        tusUploadUrl(apiUrl, creation),
        [competingPhotoA, competingPhotoB][index],
      ),
    ),
  );
  const successfulTusPatches = dualTusPatches
    .map((patch, index) => ({
      bytes: [competingPhotoA, competingPhotoB][index],
      patch,
    }))
    .filter(({ patch }) => patch.response.ok);
  if (successfulTusPatches.length !== 2) {
    throw new Error(
      `Pinned distinct-URL TUS completion behavior changed (${dualTusPatches
        .map((patch) => patch.response.status)
        .join(", ")}).`,
    );
  }

  const retainedDualTusObject = await readObject(
    apiUrl,
    serviceKey,
    dualTusReservation.object_path,
  );
  if (
    !retainedDualTusObject.response.ok ||
    !successfulTusPatches.some(({ bytes }) =>
      retainedDualTusObject.bytes.equals(bytes),
    )
  ) {
    throw new Error(
      "Adversarial dual-TUS race retained bytes from no successful patch.",
    );
  }
  acknowledgementRow(
    await acknowledgePhoto(
      apiUrl,
      apiKey,
      tokens.organizerB,
      dualTusReservation.intake_id,
    ),
    dualTusReservation,
    retainedDualTusObject.bytes.length,
    "Adversarial dual-TUS acknowledgement",
  );
  runDatabaseQuery(`
    do $assert_dual_tus_unverified$
    begin
      if not exists (
        select 1
          from private.photo_intakes
         where id = '${dualTusReservation.intake_id}'::uuid
           and state = 'uploaded_unverified'
      ) or exists (
        select 1
          from public.moments
         where kind = 'photo'
      ) then
        raise exception 'dual-TUS quarantine escaped the unverified boundary';
      end if;
    end
    $assert_dual_tus_unverified$;
  `);

  const validatorRevocationReservation = reservationRow(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.organizerB,
      CIRCLE_B,
      PERSON_ORGANIZER_B,
      randomUUID(),
    ),
    "Validator-revocation race reservation",
  );
  cleanupPaths.push(validatorRevocationReservation.object_path);
  const validatorRevocationUploadClaim = await claimPhotoUpload(
    apiUrl,
    apiKey,
    tokens.organizerB,
    validatorRevocationReservation.intake_id,
    syntheticPhoto,
  );
  uploadClaimRow(
    validatorRevocationUploadClaim,
    validatorRevocationReservation,
    "Validator-revocation race upload claim",
  );
  const validatorRevocationUpload = await uploadClaimedTus(
    apiUrl,
    apiKey,
    tokens.organizerB,
    validatorRevocationReservation.object_path,
    syntheticPhoto,
    validatorRevocationUploadClaim.uploadMetadata,
  );
  requireSuccess(
    validatorRevocationUpload.creation,
    "Validator-revocation race TUS creation",
  );
  requireSuccess(
    validatorRevocationUpload.patch,
    "Validator-revocation race TUS patch",
  );
  acknowledgementRow(
    await acknowledgePhoto(
      apiUrl,
      apiKey,
      tokens.organizerB,
      validatorRevocationReservation.intake_id,
    ),
    validatorRevocationReservation,
    syntheticPhoto.length,
    "Validator-revocation race acknowledgement",
  );

  runDatabaseQuery(`
    insert into private.photo_validator_allowlist (auth_user_id)
    values ('${NO_CIRCLE_USER}'::uuid);
  `);
  const validatorLeaseKey = randomUUID();
  const validatorLease = validationLeaseRow(
    await rpcRequest(
      apiUrl,
      apiKey,
      tokens.noCircle,
      "claim_photo_validation",
      {
        intake_id: validatorRevocationReservation.intake_id,
        lease_key: validatorLeaseKey,
      },
    ),
    validatorRevocationReservation,
    "Validator-revocation race validation claim",
  );
  const canonicalStorageObjectId = randomUUID();
  const canonicalOriginalId =
    validatorLease.canonical_object_path.split("/")[1];
  runDatabaseQuery(`
    insert into storage.objects (
      id, bucket_id, name, owner_id, metadata, user_metadata
    ) values (
      '${canonicalStorageObjectId}'::uuid,
      'our-days-originals',
      '${validatorLease.canonical_object_path}',
      '${NO_CIRCLE_USER}',
      jsonb_build_object(
        'mimetype', '${validatorLease.expected_mime_type}',
        'size', ${Number(validatorLease.expected_size_bytes)}
      ),
      jsonb_build_object(
        'validation_job_id', '${validatorLease.validation_job_id}',
        'intake_id', '${validatorLease.intake_id}',
        'original_id', '${canonicalOriginalId}',
        'lease_attempt_id', '${validatorLease.lease_attempt_id}',
        'expected_mime_type', '${validatorLease.expected_mime_type}',
        'expected_size_bytes', ${Number(validatorLease.expected_size_bytes)},
        'expected_sha256', '${validatorLease.expected_sha256_hex}',
        'verification_profile_version',
          ${Number(validatorLease.verification_profile_version)}
      )
    );
  `);

  const validatorRevocationPromise = rpcRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "phase4b_test_revoke_validator_and_hold",
    { hold_ms: 5000, target_auth_user_id: NO_CIRCLE_USER },
  );
  await waitForConcurrencyProbe({
    apiUrl,
    expectedWaiters: 1,
    label: "Validator revocation transaction",
    operationNames: ["phase4b_test_revoke_validator_and_hold"],
    requireSleep: true,
    serviceKey,
  });

  const postRevocationCompletionPromise = completePhotoValidation(
    apiUrl,
    apiKey,
    tokens.noCircle,
    validatorLease,
    validatorLeaseKey,
    canonicalStorageObjectId,
  );
  try {
    await waitForConcurrencyProbe({
      apiUrl,
      expectedWaiters: 1,
      label: "Post-revocation validator completion",
      operationNames: ["complete_photo_validation"],
      serviceKey,
    });
  } catch (error) {
    await Promise.allSettled([
      validatorRevocationPromise,
      postRevocationCompletionPromise,
    ]);
    throw error;
  }

  const [validatorRevocation, postRevocationCompletion] = await Promise.all([
    validatorRevocationPromise,
    postRevocationCompletionPromise,
  ]);
  requireSuccess(validatorRevocation, "Validator revocation transaction");
  requireSafeDenied(
    postRevocationCompletion,
    "Completion queued behind validator revocation",
  );
  requireSafeDenied(
    await completePhotoValidation(
      apiUrl,
      apiKey,
      tokens.noCircle,
      validatorLease,
      validatorLeaseKey,
      canonicalStorageObjectId,
    ),
    "Completion after validator revocation",
  );
  runDatabaseQuery(`
    do $assert_validator_revocation_wins$
    begin
      if not exists (
        select 1
          from private.photo_validator_allowlist
         where auth_user_id = '${NO_CIRCLE_USER}'::uuid
           and revoked_at is not null
      ) or not exists (
        select 1
          from private.photo_validation_jobs
         where id = '${validatorLease.validation_job_id}'::uuid
           and intake_id = '${validatorLease.intake_id}'::uuid
           and state = 'leased'
           and completed_at is null
      ) or not exists (
        select 1
          from private.photo_intakes
         where id = '${validatorLease.intake_id}'::uuid
           and state = 'uploaded_unverified'
           and validation_completed_at is null
      ) or exists (
        select 1
          from private.photo_originals
         where validation_job_id = '${validatorLease.validation_job_id}'::uuid
      ) or exists (
        select 1
          from private.audit_events
         where event_type = 'photo_original_verified'
           and subject_id = '${canonicalOriginalId}'::uuid
      ) then
        raise exception 'validator revocation allowed a later completion or state change';
      end if;
    end
    $assert_validator_revocation_wins$;
  `);

  const acknowledgementRace = reservationRow(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.memberA,
      CIRCLE_A,
      PERSON_MEMBER_A,
      randomUUID(),
    ),
    "Acknowledgement/revocation race reservation",
  );
  const acknowledgementCanary = reservationRow(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.memberA,
      CIRCLE_A,
      PERSON_MEMBER_A,
      randomUUID(),
    ),
    "Acknowledgement/revocation canary reservation",
  );
  cleanupPaths.push(
    acknowledgementRace.object_path,
    acknowledgementCanary.object_path,
  );
  const acknowledgementRaceClaim = await claimPhotoUpload(
    apiUrl,
    apiKey,
    tokens.memberA,
    acknowledgementRace.intake_id,
    syntheticPhoto,
  );
  uploadClaimRow(
    acknowledgementRaceClaim,
    acknowledgementRace,
    "Acknowledgement/revocation setup claim",
  );
  const acknowledgementRaceUpload = await uploadClaimedTus(
    apiUrl,
    apiKey,
    tokens.memberA,
    acknowledgementRace.object_path,
    syntheticPhoto,
    acknowledgementRaceClaim.uploadMetadata,
  );
  requireSuccess(
    acknowledgementRaceUpload.creation,
    "Acknowledgement/revocation setup TUS creation",
  );
  requireSuccess(
    acknowledgementRaceUpload.patch,
    "Acknowledgement/revocation setup TUS patch",
  );

  const [acknowledgementOutcome, acknowledgementRevocation] = await runHeldRace(
    {
      apiUrl,
      holderBody: { target_circle_id: CIRCLE_A },
      holderFunction: "phase4a_test_hold_circle_lock",
      label: "acknowledgement and membership revocation",
      requests: [
        () =>
          acknowledgePhoto(
            apiUrl,
            apiKey,
            tokens.memberA,
            acknowledgementRace.intake_id,
          ),
        () =>
          rpcRequest(apiUrl, apiKey, tokens.organizerA, "revoke_membership", {
            membership_id: MEMBER_A_MEMBERSHIP,
          }),
      ],
      serviceKey,
    },
  );
  requireSafeStorageOutcome(
    acknowledgementOutcome,
    "Acknowledgement/revocation acknowledgement",
  );
  requireSuccess(
    acknowledgementRevocation,
    "Acknowledgement/revocation membership change",
  );
  assertIntakeInvalidated(
    acknowledgementRace,
    "membership_authority_changed",
    MEMBER_A,
  );
  assertIntakeInvalidated(
    acknowledgementCanary,
    "membership_authority_changed",
    MEMBER_A,
  );
  await assertPostLossCapabilityClosed({
    apiKey,
    apiUrl,
    canary: acknowledgementCanary,
    label: "Post-membership-revocation acknowledgement race",
    reserveArgs: [CIRCLE_A, PERSON_MEMBER_A],
    target: acknowledgementRace,
    token: tokens.memberA,
    uploadMetadata: acknowledgementRaceClaim.uploadMetadata,
  });

  requireSuccess(
    await rpcRequest(
      apiUrl,
      apiKey,
      tokens.organizerATwo,
      "set_person_guardian",
      {
        grant_access: true,
        guardian_membership_id: DUAL_CIRCLE_A_MEMBERSHIP,
        managed_person_id: MANAGED_CHILD_A,
      },
    ),
    "Ordinary-member guardian grant",
  );

  runDatabaseQuery(`
    do $assert_ordinary_member_guardian$
    begin
      if not exists (
        select 1
          from public.circle_memberships as membership
          join public.person_guardians as guardian
            on guardian.circle_id = membership.circle_id
           and guardian.guardian_membership_id = membership.id
         where membership.id = '${DUAL_CIRCLE_A_MEMBERSHIP}'::uuid
           and membership.user_id = '${DUAL_CIRCLE_USER}'::uuid
           and membership.role = 'member'
           and membership.status = 'active'
           and guardian.managed_person_id = '${MANAGED_CHILD_A}'::uuid
           and guardian.revoked_at is null
      ) then
        raise exception 'ordinary-member guardian race fixture is not active';
      end if;
    end
    $assert_ordinary_member_guardian$;
  `);

  const guardianRace = reservationRow(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.dualCircle,
      CIRCLE_A,
      MANAGED_CHILD_A,
      randomUUID(),
    ),
    "Ordinary-member guardian upload race reservation",
  );
  const guardianCanary = reservationRow(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.dualCircle,
      CIRCLE_A,
      MANAGED_CHILD_A,
      randomUUID(),
    ),
    "Ordinary-member guardian canary reservation",
  );
  cleanupPaths.push(guardianRace.object_path, guardianCanary.object_path);

  const guardianClaim = await claimPhotoUpload(
    apiUrl,
    apiKey,
    tokens.dualCircle,
    guardianRace.intake_id,
    syntheticPhoto,
  );
  uploadClaimRow(
    guardianClaim,
    guardianRace,
    "Ordinary-member guardian race claim",
  );
  const guardianTusCreation = await createTusUpload(
    apiUrl,
    apiKey,
    tokens.dualCircle,
    guardianRace.object_path,
    syntheticPhoto.length,
    guardianClaim.uploadMetadata,
  );
  requireSuccess(
    guardianTusCreation,
    "Ordinary-member guardian race TUS creation",
  );
  const guardianTusUrl = tusUploadUrl(apiUrl, guardianTusCreation);

  const [guardianPatch, guardianRevocation] = await runHeldRace({
    apiUrl,
    holderBody: { target_circle_id: CIRCLE_A },
    holderFunction: "phase4a_test_hold_circle_lock",
    label: "TUS patch and ordinary-member guardian revocation",
    requests: [
      () =>
        patchTusUpload(
          apiKey,
          tokens.dualCircle,
          guardianTusUrl,
          syntheticPhoto,
        ),
      () =>
        rpcRequest(
          apiUrl,
          apiKey,
          tokens.organizerATwo,
          "set_person_guardian",
          {
            grant_access: false,
            guardian_membership_id: DUAL_CIRCLE_A_MEMBERSHIP,
            managed_person_id: MANAGED_CHILD_A,
          },
        ),
    ],
    serviceKey,
  });
  requireSafeStorageOutcome(
    guardianPatch,
    "Ordinary-member guardian revocation TUS patch",
  );
  requireSuccess(guardianRevocation, "Ordinary-member guardian revocation");
  await assertAcceptedPatchBytes(
    apiUrl,
    serviceKey,
    guardianPatch,
    guardianRace.object_path,
    syntheticPhoto,
    "Ordinary-member guardian revocation TUS patch",
  );
  assertIntakeInvalidated(
    guardianRace,
    "guardian_authority_revoked",
    DUAL_CIRCLE_USER,
  );
  assertIntakeInvalidated(
    guardianCanary,
    "guardian_authority_revoked",
    DUAL_CIRCLE_USER,
  );
  await assertPostLossCapabilityClosed({
    apiKey,
    apiUrl,
    canary: guardianCanary,
    label: "Post-ordinary-member guardian revocation",
    reserveArgs: [CIRCLE_A, MANAGED_CHILD_A],
    target: guardianRace,
    token: tokens.dualCircle,
    uploadMetadata: guardianClaim.uploadMetadata,
  });

  const membershipRace = reservationRow(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.organizerA,
      CIRCLE_A,
      PERSON_ORGANIZER_A,
      randomUUID(),
    ),
    "Membership-revocation upload race reservation",
  );
  const membershipCanary = reservationRow(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.organizerA,
      CIRCLE_A,
      PERSON_ORGANIZER_A,
      randomUUID(),
    ),
    "Membership-revocation canary reservation",
  );
  cleanupPaths.push(membershipRace.object_path, membershipCanary.object_path);

  const membershipClaim = await claimPhotoUpload(
    apiUrl,
    apiKey,
    tokens.organizerA,
    membershipRace.intake_id,
    syntheticPhoto,
  );
  uploadClaimRow(
    membershipClaim,
    membershipRace,
    "Membership-revocation race claim",
  );
  const membershipTusCreation = await createTusUpload(
    apiUrl,
    apiKey,
    tokens.organizerA,
    membershipRace.object_path,
    syntheticPhoto.length,
    membershipClaim.uploadMetadata,
  );
  requireSuccess(
    membershipTusCreation,
    "Membership-revocation race TUS creation",
  );
  const membershipTusUrl = tusUploadUrl(apiUrl, membershipTusCreation);

  const [membershipPatch, membershipRevocation] = await runHeldRace({
    apiUrl,
    holderBody: { target_circle_id: CIRCLE_A },
    holderFunction: "phase4a_test_hold_circle_lock",
    label: "TUS patch and membership revocation",
    requests: [
      () =>
        patchTusUpload(
          apiKey,
          tokens.organizerA,
          membershipTusUrl,
          syntheticPhoto,
        ),
      () =>
        rpcRequest(apiUrl, apiKey, tokens.organizerATwo, "revoke_membership", {
          membership_id: ORGANIZER_A_MEMBERSHIP,
        }),
    ],
    serviceKey,
  });
  requireSafeStorageOutcome(membershipPatch, "Membership-revocation TUS patch");
  requireSuccess(membershipRevocation, "Membership revocation");
  await assertAcceptedPatchBytes(
    apiUrl,
    serviceKey,
    membershipPatch,
    membershipRace.object_path,
    syntheticPhoto,
    "Membership-revocation TUS patch",
  );
  assertIntakeInvalidated(
    membershipRace,
    "membership_authority_changed",
    ORGANIZER_A,
  );
  assertIntakeInvalidated(
    membershipCanary,
    "membership_authority_changed",
    ORGANIZER_A,
  );
  await assertPostLossCapabilityClosed({
    apiKey,
    apiUrl,
    canary: membershipCanary,
    label: "Post-membership-revocation upload race",
    reserveArgs: [CIRCLE_A, PERSON_ORGANIZER_A],
    target: membershipRace,
    token: tokens.organizerA,
    uploadMetadata: membershipClaim.uploadMetadata,
  });

  const closureRace = reservationRow(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.dualCircle,
      CIRCLE_B,
      PERSON_DUAL_B,
      randomUUID(),
    ),
    "Account-closure request race reservation",
  );
  const closurePrepareCanary = reservationRow(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.dualCircle,
      CIRCLE_B,
      PERSON_DUAL_B,
      randomUUID(),
    ),
    "Account-closure preparation race reservation",
  );
  cleanupPaths.push(closureRace.object_path, closurePrepareCanary.object_path);
  const closureRequestKey = randomUUID();

  runDatabaseQuery(`
    update private.photo_capabilities
       set enabled = true,
           updated_at = statement_timestamp()
     where capability = 'photo_publication';
  `);

  const closureRaceClaim = await claimPhotoUpload(
    apiUrl,
    apiKey,
    tokens.dualCircle,
    closureRace.intake_id,
    syntheticPhoto,
  );
  uploadClaimRow(
    closureRaceClaim,
    closureRace,
    "Account-closure request race claim",
  );
  const closureRaceTusCreation = await createTusUpload(
    apiUrl,
    apiKey,
    tokens.dualCircle,
    closureRace.object_path,
    syntheticPhoto.length,
    closureRaceClaim.uploadMetadata,
  );
  requireSuccess(
    closureRaceTusCreation,
    "Account-closure request race TUS creation",
  );
  const closureRaceTusUrl = tusUploadUrl(apiUrl, closureRaceTusCreation);

  const closurePrepareClaim = await claimPhotoUpload(
    apiUrl,
    apiKey,
    tokens.dualCircle,
    closurePrepareCanary.intake_id,
    syntheticPhoto,
  );
  uploadClaimRow(
    closurePrepareClaim,
    closurePrepareCanary,
    "Account-closure preparation race claim",
  );
  const closurePrepareTusCreation = await createTusUpload(
    apiUrl,
    apiKey,
    tokens.dualCircle,
    closurePrepareCanary.object_path,
    syntheticPhoto.length,
    closurePrepareClaim.uploadMetadata,
  );
  requireSuccess(
    closurePrepareTusCreation,
    "Account-closure preparation race TUS creation",
  );
  const closurePrepareTusUrl = tusUploadUrl(apiUrl, closurePrepareTusCreation);

  const [closureRacePatch, closureRequest, stagedClosureReservation] =
    await runHeldRace({
      apiUrl,
      holderBody: { target_auth_user_id: DUAL_CIRCLE_USER },
      holderFunction: "phase4a_test_hold_auth_user_lock",
      label: "TUS patch and account-closure request",
      requests: [
        () =>
          patchTusUpload(
            apiKey,
            tokens.dualCircle,
            closureRaceTusUrl,
            syntheticPhoto,
          ),
        () =>
          rpcRequest(
            apiUrl,
            apiKey,
            tokens.dualCircle,
            "request_account_closure",
            { request_key: closureRequestKey },
          ),
        () =>
          reservePhotoMoment(
            apiUrl,
            apiKey,
            tokens.dualCircle,
            CIRCLE_B,
            PERSON_DUAL_B,
            randomUUID(),
          ),
      ],
      serviceKey,
    });
  requireSafeStorageOutcome(
    closureRacePatch,
    "Account-closure request race TUS patch",
  );
  const closureRequestId = requireSuccess(
    closureRequest,
    "Account-closure request",
  );
  const closureIntakes = [closureRace, closurePrepareCanary];
  if (stagedClosureReservation.response.ok) {
    const staged = reservationRow(
      stagedClosureReservation,
      "Concurrent staged photo-moment reservation",
    );
    closureIntakes.push(staged);
    cleanupPaths.push(staged.object_path);
  } else {
    requireSafeDenied(
      stagedClosureReservation,
      "Concurrent staged photo-moment reservation",
    );
  }
  await assertAcceptedPatchBytes(
    apiUrl,
    serviceKey,
    closureRacePatch,
    closureRace.object_path,
    syntheticPhoto,
    "Account-closure request race TUS patch",
  );
  assertClosureRequestedButUnauthorized(closureIntakes, closureRequestId);
  requireSafeDenied(
    await acknowledgePhoto(
      apiUrl,
      apiKey,
      tokens.dualCircle,
      closureRace.intake_id,
    ),
    "Closure-requested acknowledgement",
  );
  requireSafeDenied(
    await createTusUpload(
      apiUrl,
      apiKey,
      tokens.dualCircle,
      closureRace.object_path,
      syntheticPhoto.length,
      closureRaceClaim.uploadMetadata,
    ),
    "Closure-requested TUS creation",
  );

  const [closurePreparePatch, closurePreparation] = await runHeldRace({
    apiUrl,
    expectedContenders: 1,
    holderBody: { target_auth_user_id: DUAL_CIRCLE_USER },
    holderFunction: "phase4a_test_hold_auth_user_lock",
    label: "already unauthorized TUS patch during account-closure preparation",
    requests: [
      () =>
        patchTusUpload(
          apiKey,
          tokens.dualCircle,
          closurePrepareTusUrl,
          syntheticPhoto,
        ),
      () =>
        rpcRequest(
          apiUrl,
          serviceKey,
          serviceKey,
          "phase4a_test_prepare_account_closure",
          { closure_request_id: closureRequestId },
        ),
    ],
    serviceKey,
  });
  requireSafeDenied(
    closurePreparePatch,
    "Account-closure preparation stale TUS patch",
  );
  const preparedClosureId = requireSuccess(
    closurePreparation,
    "Account-closure preparation",
  );
  if (preparedClosureId !== closureRequestId) {
    throw new Error("Account-closure preparation changed request identity.");
  }
  assertClosurePrepared(closureRequestId, closureIntakes);
  requireSafeDenied(
    await claimPhotoUpload(
      apiUrl,
      apiKey,
      tokens.dualCircle,
      closurePrepareCanary.intake_id,
      syntheticPhoto,
    ),
    "Prepared-closure fresh upload claim",
  );
  requireSafeDenied(
    await createTusUpload(
      apiUrl,
      apiKey,
      tokens.dualCircle,
      closurePrepareCanary.object_path,
      syntheticPhoto.length,
      closurePrepareClaim.uploadMetadata,
    ),
    "Prepared-closure TUS creation",
  );
  requireSafeDenied(
    await reservePhoto(
      apiUrl,
      apiKey,
      tokens.dualCircle,
      CIRCLE_B,
      PERSON_DUAL_B,
      randomUUID(),
    ),
    "Prepared-closure reservation",
  );

  process.stdout.write(
    "Forced Phase 4A duplicate reservation, fingerprint-claim, deterministic same/distinct-URL TUS, claim/authority-loss, acknowledgement/revocation, ordinary-member guardian revocation, account-closure request plus staged-photo race, and preparation-time stale-patch checks preserved only quarantined, unverified state; Phase 4B revocation-first serialization denied post-revocation completion without changing the intake, job, original, or audit ledgers.\n",
  );
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  let cleanupError;

  try {
    const apiUrl = localStatus?.API_URL;
    const serviceKey = localStatus?.SERVICE_ROLE_KEY ?? localStatus?.SECRET_KEY;
    if (apiUrl && serviceKey && cleanupPaths.length > 0) {
      await deleteObjects(apiUrl, serviceKey, cleanupPaths);
    }
  } catch (error) {
    cleanupError = error;
  }

  try {
    if (shouldRestoreFixtures) resetDatabase();
  } catch (error) {
    cleanupError ??= error;
  }

  if (cleanupError) {
    if (primaryError) {
      process.stderr.write(
        `Fixture restoration also failed: ${cleanupError.message}\n`,
      );
    } else {
      throw cleanupError;
    }
  }
}
