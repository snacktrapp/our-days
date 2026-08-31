import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const supabaseBinary = fileURLToPath(
  new URL("../node_modules/.bin/supabase", import.meta.url),
);

const CIRCLE_A = "20000000-0000-4000-8000-000000000001";
const CIRCLE_B = "20000000-0000-4000-8000-000000000002";
const ORGANIZER_A_PERSON = "30000000-0000-4000-8000-000000000001";
const MEMBER_A_PERSON = "30000000-0000-4000-8000-000000000003";
const ORGANIZER_B_PERSON = "30000000-0000-4000-8000-000000000006";
const ORGANIZER_A_MEMBERSHIP = "40000000-0000-4000-8000-000000000001";
const MEMBER_A_MEMBERSHIP = "40000000-0000-4000-8000-000000000003";
const ORGANIZER_B_MEMBERSHIP = "40000000-0000-4000-8000-000000000006";

const VALIDATOR_REVOKED = "90000000-0000-4000-8000-000000000001";
const VALIDATOR_AUTHORITY = "90000000-0000-4000-8000-000000000002";
const VALIDATOR_STALE = "90000000-0000-4000-8000-000000000003";
const VALIDATOR_TAKEOVER = "90000000-0000-4000-8000-000000000004";

const OUTPUT_SIZE_BYTES = 128;
const OUTPUT_SHA256 = "ab".repeat(32);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const derivativePathPattern =
  /^display\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/iu;

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

function runDatabaseQuery(sql) {
  try {
    execFileSync(supabaseBinary, ["db", "query", "--local", sql], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error.stdout?.toString().trim();
    throw new Error(
      `Local photo-derivative concurrency assertion failed${detail ? `: ${detail}` : "."}`,
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

async function rpcRequest(apiUrl, apiKey, token, functionName, body) {
  const response = await fetch(`${apiUrl}/rest/v1/rpc/${functionName}`, {
    body: JSON.stringify(body),
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

  return { body: await parseResponse(response), response };
}

function requireSuccess(result, label) {
  if (!result.response.ok) {
    throw new Error(
      `${label} failed with ${result.response.status} (${result.body?.code ?? "no code"}, ${JSON.stringify(result.body)}).`,
    );
  }
  return result.body;
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

function derivativeLeaseRow(result, originalId, label) {
  const row = Array.isArray(result.body) ? result.body[0] : result.body;
  if (
    !result.response.ok ||
    !row ||
    !uuidPattern.test(row.derivative_job_id) ||
    !uuidPattern.test(row.lease_attempt_id) ||
    row.original_id !== originalId ||
    row.source_bucket_id !== "our-days-originals" ||
    !uuidPattern.test(row.source_storage_object_id) ||
    row.display_bucket_id !== "our-days-display" ||
    !derivativePathPattern.test(row.display_object_path) ||
    row.display_object_path.split("/")[2] !== `${row.lease_attempt_id}.webp` ||
    Number(row.transform_profile_version) !== 1 ||
    typeof row.lease_expires_at !== "string"
  ) {
    throw new Error(
      `${label} returned an invalid derivative lease (${result.response.status}, ${JSON.stringify(result.body)}).`,
    );
  }
  return row;
}

async function claimDerivative(apiUrl, apiKey, token, originalId, leaseKey) {
  return rpcRequest(apiUrl, apiKey, token, "claim_photo_display_derivative", {
    lease_key: leaseKey,
    original_id: originalId,
  });
}

async function completeDerivative(
  apiUrl,
  apiKey,
  token,
  lease,
  leaseKey,
  storageObjectId,
) {
  return rpcRequest(
    apiUrl,
    apiKey,
    token,
    "complete_photo_display_derivative",
    {
      derivative_job_id: lease.derivative_job_id,
      lease_key: leaseKey,
      output_channels: 3,
      output_height: 4,
      output_pages: 1,
      output_sha256_hex: OUTPUT_SHA256,
      output_size_bytes: OUTPUT_SIZE_BYTES,
      output_width: 4,
      storage_object_id: storageObjectId,
      storage_object_version: "",
    },
  );
}

function installSyntheticValidators() {
  runDatabaseQuery(`
    do $install_validators$
    begin
      insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
      values
        ('${VALIDATOR_REVOKED}'::uuid, 'phase4c-revoked@example.test', statement_timestamp(), '{}'),
        ('${VALIDATOR_AUTHORITY}'::uuid, 'phase4c-authority@example.test', statement_timestamp(), '{}'),
        ('${VALIDATOR_STALE}'::uuid, 'phase4c-stale@example.test', statement_timestamp(), '{}'),
        ('${VALIDATOR_TAKEOVER}'::uuid, 'phase4c-takeover@example.test', statement_timestamp(), '{}');

      insert into auth.sessions (
        id, user_id, created_at, updated_at, not_after
      )
      values
        ('${VALIDATOR_REVOKED}'::uuid, '${VALIDATOR_REVOKED}'::uuid, statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '1 day'),
        ('${VALIDATOR_AUTHORITY}'::uuid, '${VALIDATOR_AUTHORITY}'::uuid, statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '1 day'),
        ('${VALIDATOR_STALE}'::uuid, '${VALIDATOR_STALE}'::uuid, statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '1 day'),
        ('${VALIDATOR_TAKEOVER}'::uuid, '${VALIDATOR_TAKEOVER}'::uuid, statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '1 day');

      insert into private.photo_validator_allowlist (auth_user_id)
      values
        ('${VALIDATOR_REVOKED}'::uuid),
        ('${VALIDATOR_AUTHORITY}'::uuid),
        ('${VALIDATOR_STALE}'::uuid),
        ('${VALIDATOR_TAKEOVER}'::uuid);
    end
    $install_validators$;
  `);
}

function createVerifiedOriginalFixture({
  circleId,
  journalPersonId,
  membershipId,
  validatorId,
}) {
  const intakeId = randomUUID();
  const validationJobId = randomUUID();
  const originalId = randomUUID();
  const originalLeaseAttemptId = randomUUID();
  const intakeRequestKey = randomUUID();
  const uploadRequestKey = randomUUID();
  const quarantineStorageObjectId = randomUUID();
  const originalStorageObjectId = randomUUID();
  const validationLeaseKey = randomUUID();
  const sourceSha256 = "cd".repeat(32);
  const originalPath = `original/${originalId}/${originalLeaseAttemptId}`;

  for (const value of [
    intakeId,
    validationJobId,
    originalId,
    originalLeaseAttemptId,
    intakeRequestKey,
    uploadRequestKey,
    quarantineStorageObjectId,
    originalStorageObjectId,
    validationLeaseKey,
  ]) {
    if (!uuidPattern.test(value)) {
      throw new Error("Synthetic fixture generated an invalid UUID.");
    }
  }

  runDatabaseQuery(`
    do $create_original_fixture$
    begin
      insert into private.photo_intakes (
        id, circle_id, journal_person_id, requested_by_membership_id,
        requester_authorization_version, request_key, object_path, state,
        requested_at, expires_at, upload_request_key, expected_mime_type,
        expected_size_bytes, expected_sha256, upload_claimed_at,
        upload_expires_at, uploaded_at, observed_mime_type_unverified,
        observed_size_bytes_unverified, validation_completed_at
      ) values (
        '${intakeId}'::uuid, '${circleId}'::uuid, '${journalPersonId}'::uuid,
        '${membershipId}'::uuid,
        (select updated_at from public.circle_memberships where id = '${membershipId}'::uuid),
        '${intakeRequestKey}'::uuid, 'intake/${intakeId}', 'verified',
        statement_timestamp() - interval '30 minutes',
        statement_timestamp() + interval '30 minutes',
        '${uploadRequestKey}'::uuid, 'image/jpeg', 128,
        decode('${sourceSha256}', 'hex'),
        statement_timestamp() - interval '20 minutes',
        statement_timestamp() + interval '100 minutes',
        statement_timestamp() - interval '15 minutes', 'image/jpeg', 128,
        statement_timestamp() - interval '10 minutes'
      );

      insert into private.photo_validation_jobs (
        id, circle_id, intake_id, journal_person_id,
        requested_by_membership_id, original_id, lease_attempt_id,
        canonical_object_path, verification_profile_version, state,
        validator_auth_user_id, lease_key_hash, lease_started_at,
        lease_expires_at, attempt_count, source_storage_object_id,
        source_storage_object_version, completed_at
      ) values (
        '${validationJobId}'::uuid, '${circleId}'::uuid, '${intakeId}'::uuid,
        '${journalPersonId}'::uuid, '${membershipId}'::uuid,
        '${originalId}'::uuid, '${originalLeaseAttemptId}'::uuid,
        '${originalPath}', 1, 'verified', '${validatorId}'::uuid,
        extensions.digest('${validationLeaseKey}'::text, 'sha256'),
        statement_timestamp() - interval '14 minutes',
        statement_timestamp() + interval '1 minute', 1,
        '${quarantineStorageObjectId}'::uuid, '',
        statement_timestamp() - interval '10 minutes'
      );

      insert into storage.objects (
        id, bucket_id, name, owner_id, metadata, user_metadata
      ) values (
        '${originalStorageObjectId}'::uuid, 'our-days-originals',
        '${originalPath}', '${validatorId}',
        jsonb_build_object('mimetype', 'image/jpeg', 'size', 128),
        jsonb_build_object(
          'validation_job_id', '${validationJobId}',
          'intake_id', '${intakeId}',
          'original_id', '${originalId}',
          'lease_attempt_id', '${originalLeaseAttemptId}',
          'expected_mime_type', 'image/jpeg',
          'expected_size_bytes', 128,
          'expected_sha256', '${sourceSha256}',
          'verification_profile_version', 1
        )
      );

      insert into private.photo_originals (
        id, circle_id, validation_job_id, intake_id, journal_person_id,
        recorded_by_membership_id, lease_attempt_id, object_path,
        storage_object_id, storage_object_version, verified_mime_type,
        verified_size_bytes, verified_sha256, verified_width, verified_height,
        verified_channels, verified_pages, verification_profile_version
      ) values (
        '${originalId}'::uuid, '${circleId}'::uuid,
        '${validationJobId}'::uuid, '${intakeId}'::uuid,
        '${journalPersonId}'::uuid, '${membershipId}'::uuid,
        '${originalLeaseAttemptId}'::uuid, '${originalPath}',
        '${originalStorageObjectId}'::uuid, '', 'image/jpeg', 128,
        decode('${sourceSha256}', 'hex'), 4, 4, 3, 1, 1
      );
    end
    $create_original_fixture$;
  `);

  return { originalId };
}

function insertDisplayObject(lease, validatorId, storageObjectId) {
  for (const value of [
    lease.derivative_job_id,
    lease.lease_attempt_id,
    lease.original_id,
    lease.source_storage_object_id,
    storageObjectId,
    validatorId,
  ]) {
    if (!uuidPattern.test(value)) {
      throw new Error("Refusing to interpolate invalid display evidence.");
    }
  }
  if (!derivativePathPattern.test(lease.display_object_path)) {
    throw new Error("Refusing to interpolate an invalid display path.");
  }

  runDatabaseQuery(`
    insert into storage.objects (
      id, bucket_id, name, owner_id, metadata, user_metadata
    )
    select
      '${storageObjectId}'::uuid, 'our-days-display',
      job.display_object_path, '${validatorId}',
      jsonb_build_object(
        'mimetype', 'image/webp', 'size', ${OUTPUT_SIZE_BYTES}
      ),
      jsonb_build_object(
        'derivative_job_id', job.id::text,
        'original_id', job.original_id::text,
        'derivative_id', job.derivative_id::text,
        'lease_attempt_id', job.lease_attempt_id::text,
        'source_storage_object_id', job.source_storage_object_id::text,
        'source_storage_object_version', job.source_storage_object_version,
        'output_mime_type', 'image/webp',
        'output_size_bytes', ${OUTPUT_SIZE_BYTES},
        'output_sha256', '${OUTPUT_SHA256}',
        'output_width', 4,
        'output_height', 4,
        'output_channels', 3,
        'output_pages', 1,
        'maximum_size_bytes', 12582912,
        'transform_profile_version', job.transform_profile_version
      )
      from private.photo_derivative_jobs as job
     where job.id = '${lease.derivative_job_id}'::uuid
       and job.lease_attempt_id = '${lease.lease_attempt_id}'::uuid;
  `);
}

function installTestHelpers() {
  runDatabaseQuery(`
    create function public.phase4c_test_concurrency_probe(
      operation_names text[], expected_waiters integer, require_sleep boolean
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
    $body$;
  `);

  runDatabaseQuery(`
    create function public.phase4c_test_revoke_validator_and_hold(
      target_auth_user_id uuid, hold_ms integer
    )
    returns void
    language plpgsql
    volatile
    security definer
    set search_path = ''
    as $body$
    begin
      if target_auth_user_id <> '${VALIDATOR_REVOKED}'::uuid
        or hold_ms not between 1 and 15000 then
        raise exception using errcode = '42501',
          message = 'Test validator revocation unavailable';
      end if;
      update private.photo_validator_allowlist
         set revoked_at = statement_timestamp()
       where auth_user_id = target_auth_user_id
         and revoked_at is null;
      if not found then
        raise exception using errcode = '42501',
          message = 'Test validator revocation unavailable';
      end if;
      perform pg_catalog.pg_sleep(hold_ms::double precision / 1000);
    end
    $body$;
  `);

  runDatabaseQuery(`
    create function public.phase4c_test_revoke_requester_and_hold(
      target_membership_id uuid, hold_ms integer
    )
    returns void
    language plpgsql
    volatile
    security definer
    set search_path = ''
    as $body$
    begin
      if target_membership_id <> '${MEMBER_A_MEMBERSHIP}'::uuid
        or hold_ms not between 1 and 15000 then
        raise exception using errcode = '42501',
          message = 'Test requester revocation unavailable';
      end if;
      update public.circle_memberships
         set status = 'revoked',
             revoked_at = statement_timestamp(),
             revoked_by_membership_id = '${ORGANIZER_A_MEMBERSHIP}'::uuid
       where id = target_membership_id
         and status = 'active';
      if not found then
        raise exception using errcode = '42501',
          message = 'Test requester revocation unavailable';
      end if;
      perform pg_catalog.pg_sleep(hold_ms::double precision / 1000);
    end
    $body$;
  `);

  runDatabaseQuery(`
    create function public.phase4c_test_source_is_readable_as(
      target_auth_user_id uuid, target_derivative_job_id uuid
    )
    returns boolean
    language plpgsql
    volatile
    security definer
    set search_path = ''
    as $body$
    declare
      target_job private.photo_derivative_jobs%rowtype;
      target_original private.photo_originals%rowtype;
    begin
      if target_auth_user_id not in (
        '${VALIDATOR_STALE}'::uuid, '${VALIDATOR_TAKEOVER}'::uuid
      ) then
        raise exception using errcode = '42501',
          message = 'Test source-read probe unavailable';
      end if;
      select * into target_job
        from private.photo_derivative_jobs
       where id = target_derivative_job_id;
      select * into target_original
        from private.photo_originals
       where id = target_job.original_id;
      perform pg_catalog.set_config(
        'request.jwt.claim.sub', target_auth_user_id::text, true
      );
      return private.photo_derivative_source_is_readable(
        target_original.object_path,
        target_original.storage_object_id,
        target_original.storage_object_version
      );
    end
    $body$;
  `);

  runDatabaseQuery(`
    do $helper_acl$
    begin
      execute 'revoke all on function public.phase4c_test_concurrency_probe(text[], integer, boolean) from public, anon, authenticated';
      execute 'revoke all on function public.phase4c_test_revoke_validator_and_hold(uuid, integer) from public, anon, authenticated';
      execute 'revoke all on function public.phase4c_test_revoke_requester_and_hold(uuid, integer) from public, anon, authenticated';
      execute 'revoke all on function public.phase4c_test_source_is_readable_as(uuid, uuid) from public, anon, authenticated';
      execute 'grant execute on function public.phase4c_test_concurrency_probe(text[], integer, boolean) to service_role';
      execute 'grant execute on function public.phase4c_test_revoke_validator_and_hold(uuid, integer) to service_role';
      execute 'grant execute on function public.phase4c_test_revoke_requester_and_hold(uuid, integer) to service_role';
      execute 'grant execute on function public.phase4c_test_source_is_readable_as(uuid, uuid) to service_role';
    end
    $helper_acl$;
  `);
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
      "phase4c_test_concurrency_probe",
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

async function runRevocationFirstRace({
  apiUrl,
  completion,
  holderBody,
  holderFunction,
  label,
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
    label: `${label} holder`,
    operationNames: [holderFunction],
    requireSleep: true,
    serviceKey,
  });

  const completionPromise = completion();
  try {
    await waitForConcurrencyProbe({
      apiUrl,
      expectedWaiters: 1,
      label: `${label} blocked completion`,
      operationNames: ["complete_photo_display_derivative"],
      serviceKey,
    });
  } catch (error) {
    await Promise.allSettled([holderPromise, completionPromise]);
    throw error;
  }

  const [holder, completionResult] = await Promise.all([
    holderPromise,
    completionPromise,
  ]);
  requireSuccess(holder, `${label} holder`);
  requireSafeDenied(completionResult, `${label} completion`);
}

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
  shouldRestoreFixtures = true;
  installSyntheticValidators();
  installTestHelpers();

  await waitForConcurrencyProbe({
    apiUrl,
    expectedWaiters: 0,
    label: "Phase 4C concurrency probe schema cache",
    operationNames: ["phase4c-schema-ready"],
    serviceKey,
  });

  const tokens = {
    authority: createLocalUserToken(VALIDATOR_AUTHORITY, jwtSecret),
    revoked: createLocalUserToken(VALIDATOR_REVOKED, jwtSecret),
    stale: createLocalUserToken(VALIDATOR_STALE, jwtSecret),
    takeover: createLocalUserToken(VALIDATOR_TAKEOVER, jwtSecret),
  };

  const revocationFixture = createVerifiedOriginalFixture({
    circleId: CIRCLE_B,
    journalPersonId: ORGANIZER_B_PERSON,
    membershipId: ORGANIZER_B_MEMBERSHIP,
    validatorId: VALIDATOR_REVOKED,
  });
  const revokedLeaseKey = randomUUID();
  const revokedLease = derivativeLeaseRow(
    await claimDerivative(
      apiUrl,
      apiKey,
      tokens.revoked,
      revocationFixture.originalId,
      revokedLeaseKey,
    ),
    revocationFixture.originalId,
    "Validator-revocation derivative claim",
  );
  const revokedDisplayObjectId = randomUUID();
  insertDisplayObject(revokedLease, VALIDATOR_REVOKED, revokedDisplayObjectId);

  await runRevocationFirstRace({
    apiUrl,
    completion: () =>
      completeDerivative(
        apiUrl,
        apiKey,
        tokens.revoked,
        revokedLease,
        revokedLeaseKey,
        revokedDisplayObjectId,
      ),
    holderBody: { target_auth_user_id: VALIDATOR_REVOKED },
    holderFunction: "phase4c_test_revoke_validator_and_hold",
    label: "validator revocation",
    serviceKey,
  });

  runDatabaseQuery(`
    do $assert_validator_revocation$
    begin
      if not exists (
        select 1 from private.photo_validator_allowlist
         where auth_user_id = '${VALIDATOR_REVOKED}'::uuid
           and revoked_at is not null
      ) or not exists (
        select 1 from private.photo_derivative_jobs
         where id = '${revokedLease.derivative_job_id}'::uuid
           and state = 'leased'
           and completed_at is null
      ) or exists (
        select 1 from private.photo_display_derivatives
         where derivative_job_id = '${revokedLease.derivative_job_id}'::uuid
      ) or exists (
        select 1 from private.audit_events
         where event_type = 'photo_display_derivative_generated'
           and subject_id = (
             select derivative_id from private.photo_derivative_jobs
              where id = '${revokedLease.derivative_job_id}'::uuid
           )
      ) then
        raise exception 'revocation-first race published a derivative or audit';
      end if;
    end
    $assert_validator_revocation$;
  `);

  const authorityFixture = createVerifiedOriginalFixture({
    circleId: CIRCLE_A,
    journalPersonId: MEMBER_A_PERSON,
    membershipId: MEMBER_A_MEMBERSHIP,
    validatorId: VALIDATOR_AUTHORITY,
  });
  const authorityLeaseKey = randomUUID();
  const authorityLease = derivativeLeaseRow(
    await claimDerivative(
      apiUrl,
      apiKey,
      tokens.authority,
      authorityFixture.originalId,
      authorityLeaseKey,
    ),
    authorityFixture.originalId,
    "Requester-authority derivative claim",
  );
  const authorityDisplayObjectId = randomUUID();
  insertDisplayObject(
    authorityLease,
    VALIDATOR_AUTHORITY,
    authorityDisplayObjectId,
  );

  await runRevocationFirstRace({
    apiUrl,
    completion: () =>
      completeDerivative(
        apiUrl,
        apiKey,
        tokens.authority,
        authorityLease,
        authorityLeaseKey,
        authorityDisplayObjectId,
      ),
    holderBody: { target_membership_id: MEMBER_A_MEMBERSHIP },
    holderFunction: "phase4c_test_revoke_requester_and_hold",
    label: "requester authority revocation",
    serviceKey,
  });

  runDatabaseQuery(`
    do $assert_requester_revocation$
    begin
      if not exists (
        select 1 from public.circle_memberships
         where id = '${MEMBER_A_MEMBERSHIP}'::uuid
           and status = 'revoked'
           and revoked_at is not null
      ) or not exists (
        select 1 from private.photo_derivative_jobs
         where id = '${authorityLease.derivative_job_id}'::uuid
           and state = 'invalidated'
           and invalidation_reason = 'requester_authority_lost'
           and completed_at is null
      ) or exists (
        select 1 from private.photo_display_derivatives
         where derivative_job_id = '${authorityLease.derivative_job_id}'::uuid
      ) or exists (
        select 1 from private.audit_events
         where event_type = 'photo_display_derivative_generated'
           and subject_id = (
             select derivative_id from private.photo_derivative_jobs
              where id = '${authorityLease.derivative_job_id}'::uuid
           )
      ) then
        raise exception 'requester revocation allowed derivative publication';
      end if;
    end
    $assert_requester_revocation$;
  `);

  const takeoverFixture = createVerifiedOriginalFixture({
    circleId: CIRCLE_A,
    journalPersonId: ORGANIZER_A_PERSON,
    membershipId: ORGANIZER_A_MEMBERSHIP,
    validatorId: VALIDATOR_STALE,
  });
  const staleLeaseKey = randomUUID();
  const staleLease = derivativeLeaseRow(
    await claimDerivative(
      apiUrl,
      apiKey,
      tokens.stale,
      takeoverFixture.originalId,
      staleLeaseKey,
    ),
    takeoverFixture.originalId,
    "Stale-attempt derivative claim",
  );

  runDatabaseQuery(`
    update private.photo_derivative_jobs
       set lease_started_at = statement_timestamp() - interval '16 minutes',
           lease_expires_at = statement_timestamp() - interval '1 minute'
     where id = '${staleLease.derivative_job_id}'::uuid;
  `);

  requireSafeDenied(
    await completeDerivative(
      apiUrl,
      apiKey,
      tokens.stale,
      staleLease,
      staleLeaseKey,
      randomUUID(),
    ),
    "Expired derivative completion",
  );
  requireSafeDenied(
    await claimDerivative(
      apiUrl,
      apiKey,
      tokens.stale,
      takeoverFixture.originalId,
      staleLeaseKey,
    ),
    "Same-validator expired derivative reclaim",
  );

  const staleRead = requireSuccess(
    await rpcRequest(
      apiUrl,
      serviceKey,
      serviceKey,
      "phase4c_test_source_is_readable_as",
      {
        target_auth_user_id: VALIDATOR_STALE,
        target_derivative_job_id: staleLease.derivative_job_id,
      },
    ),
    "Expired source-read probe",
  );
  if (staleRead !== false) {
    throw new Error("Expired validator retained source-read authority.");
  }

  const takeoverLeaseKey = randomUUID();
  const takeoverLease = derivativeLeaseRow(
    await claimDerivative(
      apiUrl,
      apiKey,
      tokens.takeover,
      takeoverFixture.originalId,
      takeoverLeaseKey,
    ),
    takeoverFixture.originalId,
    "Different-validator derivative takeover",
  );
  if (
    takeoverLease.derivative_job_id !== staleLease.derivative_job_id ||
    takeoverLease.lease_attempt_id === staleLease.lease_attempt_id ||
    takeoverLease.display_object_path === staleLease.display_object_path
  ) {
    throw new Error("Derivative takeover did not mint a fresh attempt path.");
  }

  const postTakeoverStaleRead = requireSuccess(
    await rpcRequest(
      apiUrl,
      serviceKey,
      serviceKey,
      "phase4c_test_source_is_readable_as",
      {
        target_auth_user_id: VALIDATOR_STALE,
        target_derivative_job_id: staleLease.derivative_job_id,
      },
    ),
    "Post-takeover stale source-read probe",
  );
  const takeoverRead = requireSuccess(
    await rpcRequest(
      apiUrl,
      serviceKey,
      serviceKey,
      "phase4c_test_source_is_readable_as",
      {
        target_auth_user_id: VALIDATOR_TAKEOVER,
        target_derivative_job_id: takeoverLease.derivative_job_id,
      },
    ),
    "Takeover source-read probe",
  );
  if (postTakeoverStaleRead !== false || takeoverRead !== true) {
    throw new Error("Takeover did not transfer source-read authority exactly.");
  }

  const takeoverDisplayObjectId = randomUUID();
  insertDisplayObject(
    takeoverLease,
    VALIDATOR_TAKEOVER,
    takeoverDisplayObjectId,
  );
  const completedDerivativeId = requireSuccess(
    await completeDerivative(
      apiUrl,
      apiKey,
      tokens.takeover,
      takeoverLease,
      takeoverLeaseKey,
      takeoverDisplayObjectId,
    ),
    "Fresh takeover completion",
  );
  if (!uuidPattern.test(completedDerivativeId)) {
    throw new Error("Fresh takeover returned an invalid derivative identity.");
  }

  runDatabaseQuery(`
    do $assert_takeover$
    begin
      if not exists (
        select 1
          from private.photo_derivative_jobs as job
          join private.photo_display_derivatives as derivative
            on derivative.derivative_job_id = job.id
         where job.id = '${takeoverLease.derivative_job_id}'::uuid
           and job.state = 'verified'
           and job.attempt_count = 2
           and job.lease_attempt_id = '${takeoverLease.lease_attempt_id}'::uuid
           and derivative.id = '${completedDerivativeId}'::uuid
           and derivative.lease_attempt_id = '${takeoverLease.lease_attempt_id}'::uuid
           and derivative.object_path = '${takeoverLease.display_object_path}'
      ) or exists (
        select 1 from private.photo_display_derivatives
         where derivative_job_id = '${staleLease.derivative_job_id}'::uuid
           and lease_attempt_id = '${staleLease.lease_attempt_id}'::uuid
      ) or (
        select count(*) from private.audit_events
         where event_type = 'photo_display_derivative_generated'
           and subject_id = '${completedDerivativeId}'::uuid
      ) <> 1 then
        raise exception 'takeover did not publish exactly the fresh attempt';
      end if;
    end
    $assert_takeover$;
  `);

  process.stdout.write(
    "Phase 4C derivative concurrency passed: validator revocation and requester-authority loss each committed ahead of a visibly blocked completion with zero derivative/audit publication; an expired validator could neither complete, reclaim, nor read its source, while a different validator received a fresh attempt path and published exactly that attempt.\n",
  );
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  let cleanupError;
  try {
    if (shouldRestoreFixtures) resetDatabase();
  } catch (error) {
    cleanupError = error;
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
