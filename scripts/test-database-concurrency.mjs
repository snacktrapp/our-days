import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const supabaseBinary = fileURLToPath(
  new URL("../node_modules/.bin/supabase", import.meta.url),
);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

  if (output.trimStart().startsWith("{")) {
    return JSON.parse(output);
  }

  return Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
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
    sub: userId,
  });
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
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
      `Local database query failed${detail ? `: ${detail}` : "."}`,
      { cause: error },
    );
  }
}

async function waitForConcurrencyProbe({
  apiKey,
  apiUrl,
  expectedWaiters,
  label,
  operationNames,
  requireSleep = false,
  serviceKey,
  timeoutMs = 4000,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus;

  while (Date.now() < deadline) {
    const probe = await jsonRequest(
      apiUrl,
      apiKey,
      serviceKey,
      "rpc/phase2_test_concurrency_probe",
      {
        body: JSON.stringify({
          expected_waiters: expectedWaiters,
          operation_names: operationNames,
          require_sleep: requireSleep,
        }),
        method: "POST",
      },
    );
    lastStatus = probe.response.status;
    if (probe.response.ok && probe.body === true) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `${label} was not observed before timeout (last probe status ${lastStatus ?? "none"}).`,
  );
}

async function waitForOperationCounts({
  apiKey,
  apiUrl,
  expectedOperations,
  label,
  requireSleep = false,
  serviceKey,
  timeoutMs = 4000,
}) {
  const operationNames = Object.keys(expectedOperations);
  const expectedWaiters = operationNames.map(
    (operationName) => expectedOperations[operationName],
  );
  const deadline = Date.now() + timeoutMs;
  let lastStatus;

  while (Date.now() < deadline) {
    const probe = await jsonRequest(
      apiUrl,
      apiKey,
      serviceKey,
      "rpc/phase2c_test_concurrency_probe",
      {
        body: JSON.stringify({
          expected_waiters: expectedWaiters,
          operation_names: operationNames,
          require_sleep: requireSleep,
        }),
        method: "POST",
      },
    );
    lastStatus = probe.response.status;
    if (probe.response.ok && probe.body === true) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `${label} was not observed with per-operation waiter counts before timeout (last probe status ${lastStatus ?? "none"}).`,
  );
}

async function request(apiUrl, apiKey, token, path, init = {}) {
  return fetch(`${apiUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

async function jsonRequest(apiUrl, apiKey, token, path, init = {}) {
  const url = path.startsWith("/")
    ? `${apiUrl}${path}`
    : `${apiUrl}/rest/v1/${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { body, response };
}

async function runOverlappedCircleRace({
  apiKey,
  apiUrl,
  circleId,
  holderToken,
  operationName,
  operationNames = [operationName],
  requests,
  serviceKey,
}) {
  const holderPromise = request(
    apiUrl,
    apiKey,
    holderToken,
    "rpc/phase2_test_hold_circle_lock",
    {
      body: JSON.stringify({ circle_id: circleId, hold_ms: 5000 }),
      method: "POST",
    },
  );

  await waitForConcurrencyProbe({
    apiKey,
    apiUrl,
    expectedWaiters: 1,
    label: `The ${operationName} circle-lock holder`,
    operationNames: ["phase2_test_hold_circle_lock"],
    requireSleep: true,
    serviceKey,
  });

  const requestPromises = requests.map((startRequest) => startRequest());
  try {
    await waitForConcurrencyProbe({
      apiKey,
      apiUrl,
      expectedWaiters: 2,
      label: `Two overlapping ${operationName} requests`,
      operationNames,
      serviceKey,
    });
  } catch (error) {
    await Promise.allSettled([holderPromise, ...requestPromises]);
    throw error;
  }

  const [holderResponse, results] = await Promise.all([
    holderPromise,
    Promise.all(requestPromises),
  ]);
  if (!holderResponse.ok) {
    const holderError = await holderResponse.text();
    throw new Error(
      `The ${operationName} circle-lock holder failed with ${holderResponse.status}: ${holderError}`,
    );
  }

  return results;
}

async function runOverlappedAuthRace({
  apiKey,
  apiUrl,
  operationName,
  operationNames,
  requests,
  serviceKey,
  targetAuthUserId,
}) {
  const holderPromise = jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "rpc/phase7c_test_hold_auth_user_lock",
    {
      body: JSON.stringify({
        target_auth_user_id: targetAuthUserId,
        hold_ms: 5000,
      }),
      method: "POST",
    },
  );

  await waitForConcurrencyProbe({
    apiKey,
    apiUrl,
    expectedWaiters: 1,
    label: `The ${operationName} Auth-user-lock holder`,
    operationNames: ["phase7c_test_hold_auth_user_lock"],
    requireSleep: true,
    serviceKey,
  });

  const requestPromises = requests.map((startRequest) => startRequest());
  try {
    await waitForConcurrencyProbe({
      apiKey,
      apiUrl,
      expectedWaiters: requests.length,
      label: `Overlapping ${operationName} requests`,
      operationNames,
      serviceKey,
    });
  } catch (error) {
    await Promise.allSettled([holderPromise, ...requestPromises]);
    throw error;
  }

  const [holder, results] = await Promise.all([
    holderPromise,
    Promise.all(requestPromises),
  ]);
  if (!holder.response.ok) {
    throw new Error(
      `The ${operationName} Auth-user-lock holder failed with ${holder.response.status}.`,
    );
  }

  return results;
}

async function runTargetBoundInvitationRace({
  apiKey,
  apiUrl,
  expectedOperations,
  jobId,
  label,
  requests,
  serviceKey,
}) {
  const holderPromise = jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "rpc/phase2c_test_hold_invitation_chain",
    {
      body: JSON.stringify({ hold_ms: 5000, target_job_id: jobId }),
      method: "POST",
    },
  );

  await waitForOperationCounts({
    apiKey,
    apiUrl,
    expectedOperations: { phase2c_test_hold_invitation_chain: 1 },
    label: `The ${label} invitation-chain holder`,
    requireSleep: true,
    serviceKey,
  });

  const requestPromises = requests.map((startRequest) => startRequest());
  try {
    await waitForOperationCounts({
      apiKey,
      apiUrl,
      expectedOperations,
      label: `Overlapping ${label} requests`,
      serviceKey,
    });
  } catch (error) {
    await Promise.allSettled([holderPromise, ...requestPromises]);
    throw error;
  }

  const [holder, results] = await Promise.all([
    holderPromise,
    Promise.all(requestPromises),
  ]);
  rejectUnsafeOutcome(holder, `${label} invitation-chain holder`);
  if (!holder.response.ok) {
    throw new Error(
      `The ${label} invitation-chain holder failed with ${holder.response.status}.`,
    );
  }

  return results;
}

function outcomeCode(result) {
  return result.body?.code ?? result.body?.error;
}

function rejectUnsafeOutcome(result, label) {
  const code = outcomeCode(result);
  if (result.response.status >= 500 || code === "40P01" || code === "40001") {
    throw new Error(
      `${label} used an unsafe concurrency outcome (${result.response.status}, ${code ?? "no code"}).`,
    );
  }
}

function requireSuccessfulOutcome(result, label) {
  rejectUnsafeOutcome(result, label);
  if (!result.response.ok) {
    throw new Error(
      `${label} failed with ${result.response.status} (${outcomeCode(result) ?? "no code"}).`,
    );
  }
  return result.body;
}

function requireInvitationDenial(result, label) {
  rejectUnsafeOutcome(result, label);
  if (result.response.ok && result.body === null) return;
  if (
    !result.response.ok &&
    result.body?.code === "22023" &&
    result.body?.message === "Invitation is not available"
  ) {
    return;
  }
  throw new Error(
    `${label} did not use the generic invitation denial (${result.response.status}:${JSON.stringify(result.body)}).`,
  );
}

function requireInvitationChangeDenial(result, label) {
  rejectUnsafeOutcome(result, label);
  if (
    !result.response.ok &&
    result.body?.code === "22023" &&
    result.body?.message === "Invitation could not be changed"
  ) {
    return;
  }
  throw new Error(
    `${label} did not use the generic invitation-change denial (${result.response.status}:${JSON.stringify(result.body)}).`,
  );
}

function targetBoundMaterializationRow(result, label) {
  rejectUnsafeOutcome(result, label);
  const row = Array.isArray(result.body) ? result.body[0] : null;
  if (
    !result.response.ok ||
    !row ||
    result.body.length !== 1 ||
    !uuidPattern.test(row.job_id) ||
    !uuidPattern.test(row.invitation_id) ||
    row.state !== "materialized" ||
    row.delivery_version !== 1
  ) {
    throw new Error(
      `${label} did not return one materialized target-bound invitation (${result.response.status}:${JSON.stringify(result.body)}).`,
    );
  }
  return row;
}

function requireEmptyMaterialization(result, label) {
  rejectUnsafeOutcome(result, label);
  if (
    result.response.ok &&
    Array.isArray(result.body) &&
    result.body.length === 0
  ) {
    return;
  }
  throw new Error(
    `${label} did not return the safe empty materialization result (${result.response.status}:${JSON.stringify(result.body)}).`,
  );
}

function targetBoundLoadRow(result, label) {
  rejectUnsafeOutcome(result, label);
  const row = Array.isArray(result.body) ? result.body[0] : null;
  if (
    !result.response.ok ||
    !row ||
    result.body.length !== 1 ||
    !uuidPattern.test(row.job_id) ||
    row.state !== "materialized" ||
    row.delivery_version !== 1
  ) {
    throw new Error(
      `${label} did not return one live target-bound job (${result.response.status}:${JSON.stringify(result.body)}).`,
    );
  }
  return row;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function invitationToken() {
  return `invite-${randomUUID()}`;
}

async function createSyntheticAuthUser(apiUrl, serviceKey, label) {
  const suffix = randomUUID();
  const result = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "/auth/v1/admin/users",
    {
      body: JSON.stringify({
        email: `phase2c-${label}-${suffix}@example.test`,
        email_confirm: true,
      }),
      method: "POST",
    },
  );
  requireSuccessfulOutcome(result, `${label} Auth fixture creation`);
  if (
    !uuidPattern.test(result.body?.id) ||
    typeof result.body?.email !== "string"
  ) {
    throw new Error(`${label} Auth fixture did not return a safe identity.`);
  }
  return { email: result.body.email, id: result.body.id };
}

async function requestTargetBoundInvitationJob({
  apiKey,
  apiUrl,
  circleId,
  displayName,
  organizerToken,
  targetAuthUserId,
}) {
  const result = await jsonRequest(
    apiUrl,
    apiKey,
    organizerToken,
    "rpc/request_invitation_job",
    {
      body: JSON.stringify({
        circle_id: circleId,
        display_name: displayName,
        request_key: randomUUID(),
        target_auth_user_id: targetAuthUserId,
      }),
      method: "POST",
    },
  );
  requireSuccessfulOutcome(result, `${displayName} job request`);
  if (!uuidPattern.test(result.body)) {
    throw new Error(`${displayName} job request did not return an ID.`);
  }
  return result.body;
}

function materializeTargetBoundInvitation(apiUrl, serviceKey, jobId, rawToken) {
  return jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "rpc/phase2c_test_materialize_target_bound_invitation_job",
    {
      body: JSON.stringify({
        requested_delivery_version: 1,
        requested_job_id: jobId,
        requested_token_sha256_hex: sha256Hex(rawToken),
      }),
      method: "POST",
    },
  );
}

function loadTargetBoundInvitation(apiUrl, serviceKey, jobId) {
  return jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "rpc/phase2c_test_load_target_bound_invitation_job",
    {
      body: JSON.stringify({ requested_job_id: jobId }),
      method: "POST",
    },
  );
}

function acceptInvitation(
  apiUrl,
  apiKey,
  token,
  rawInvitationToken,
  rpcName = "accept_invitation",
) {
  return jsonRequest(apiUrl, apiKey, token, `rpc/${rpcName}`, {
    body: JSON.stringify({ token: rawInvitationToken }),
    method: "POST",
  });
}

function revokeInvitation(
  apiUrl,
  apiKey,
  organizerToken,
  invitationId,
  rpcName = "revoke_invitation",
) {
  return jsonRequest(apiUrl, apiKey, organizerToken, `rpc/${rpcName}`, {
    body: JSON.stringify({ invitation_id: invitationId }),
    method: "POST",
  });
}

async function createTargetBoundJobFixture({
  apiKey,
  apiUrl,
  circleId,
  jwtSecret,
  label,
  organizerToken,
  serviceKey,
}) {
  const target = await createSyntheticAuthUser(apiUrl, serviceKey, label);
  const jobId = await requestTargetBoundInvitationJob({
    apiKey,
    apiUrl,
    circleId,
    displayName: `Phase 2C ${label}`,
    organizerToken,
    targetAuthUserId: target.id,
  });
  return {
    jobId,
    rawToken: invitationToken(),
    target,
    targetToken: createLocalUserToken(target.id, jwtSecret),
  };
}

function resetDatabase() {
  execFileSync(supabaseBinary, ["db", "reset", "--local"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const ORGANIZER_B = "10000000-0000-4000-8000-000000000006";
const DUAL_ORGANIZER_B = "10000000-0000-4000-8000-000000000005";
const ORGANIZER_A = "10000000-0000-4000-8000-000000000001";
const ORGANIZER_A_TWO = "10000000-0000-4000-8000-000000000002";
const CIRCLE_A = "20000000-0000-4000-8000-000000000001";
const CIRCLE_B = "20000000-0000-4000-8000-000000000002";
const ORGANIZER_B_MEMBERSHIP = "40000000-0000-4000-8000-000000000006";
const DUAL_ORGANIZER_B_MEMBERSHIP = "40000000-0000-4000-8000-000000000007";
const ORGANIZER_A_MEMBERSHIP = "40000000-0000-4000-8000-000000000001";
const ORGANIZER_A_TWO_MEMBERSHIP = "40000000-0000-4000-8000-000000000002";
const MEMBER_A_MEMBERSHIP = "40000000-0000-4000-8000-000000000003";
const DUAL_ORGANIZER_A_MEMBERSHIP = "40000000-0000-4000-8000-000000000005";
const MANAGED_CHILD_A = "30000000-0000-4000-8000-000000000008";

let shouldRestoreFixtures = false;
let primaryError = null;

try {
  const status = await readLocalStatus();
  const apiUrl = status.API_URL;
  const apiKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  const jwtSecret = status.JWT_SECRET;

  if (!apiUrl || !apiKey || !serviceKey || !jwtSecret) {
    throw new Error(
      "Local Supabase status did not include the required test values.",
    );
  }

  const organizerToken = createLocalUserToken(ORGANIZER_B, jwtSecret);
  const dualOrganizerToken = createLocalUserToken(DUAL_ORGANIZER_B, jwtSecret);
  const organizerAToken = createLocalUserToken(ORGANIZER_A, jwtSecret);
  const organizerATwoToken = createLocalUserToken(ORGANIZER_A_TWO, jwtSecret);

  shouldRestoreFixtures = true;
  runDatabaseQuery(`
    do $install$
    begin
      execute $definition$
        create function public.phase2_test_hold_circle_lock(
          circle_id uuid,
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
            or not (select private.is_circle_organizer(circle_id)) then
            raise exception using errcode = '42501', message = 'Test lock unavailable';
          end if;

          perform 1
            from public.circles
           where id = circle_id
           for update;
          perform pg_catalog.pg_sleep(hold_ms::double precision / 1000);
        end
        $body$
      $definition$;
      execute 'revoke all on function public.phase2_test_hold_circle_lock(uuid, integer) from public, anon, authenticated';
      execute 'grant execute on function public.phase2_test_hold_circle_lock(uuid, integer) to authenticated';

      execute $definition$
        create function public.phase2_test_concurrency_probe(
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
             and exists (
               select 1
                 from pg_catalog.unnest(operation_names) as operation_name
                where pg_catalog.strpos(
                  pg_catalog.lower(activity.query),
                  pg_catalog.lower(operation_name)
                ) > 0
             )
             and case
               when require_sleep then activity.wait_event = 'PgSleep'
               else activity.wait_event_type = 'Lock'
             end;
        $body$
      $definition$;
      execute 'revoke all on function public.phase2_test_concurrency_probe(text[], integer, boolean) from public, anon, authenticated';
      execute 'grant execute on function public.phase2_test_concurrency_probe(text[], integer, boolean) to service_role';

      execute $definition$
        create function public.phase7c_test_prepare_account_closure(
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
      execute 'revoke all on function public.phase7c_test_prepare_account_closure(uuid) from public, anon, authenticated';
      execute 'grant execute on function public.phase7c_test_prepare_account_closure(uuid) to service_role';

      execute $definition$
        create function public.phase7c_test_hold_auth_user_lock(
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
                from auth.users as auth_user
               where auth_user.id = target_auth_user_id
                 and auth_user.email like '%@example.test'
            ) then
            raise exception using errcode = '42501', message = 'Test lock unavailable';
          end if;

          perform 1
            from auth.users as auth_user
           where auth_user.id = target_auth_user_id
           for update;
          perform pg_catalog.pg_sleep(hold_ms::double precision / 1000);
        end
        $body$
      $definition$;
      execute 'revoke all on function public.phase7c_test_hold_auth_user_lock(uuid, integer) from public, anon, authenticated';
      execute 'grant execute on function public.phase7c_test_hold_auth_user_lock(uuid, integer) to service_role';

      execute $definition$
        create function public.phase2c_test_concurrency_probe(
          operation_names text[],
          expected_waiters integer[],
          require_sleep boolean
        )
        returns boolean
        language sql
        stable
        security definer
        set search_path = ''
        as $body$
          select
            pg_catalog.cardinality(operation_names) > 0
            and pg_catalog.cardinality(operation_names) =
              pg_catalog.cardinality(expected_waiters)
            and not exists (
              select 1
                from pg_catalog.generate_subscripts(
                  operation_names,
                  1
                ) as expected(position)
               where expected_waiters[expected.position] <= 0
                  or (
                    select count(*)
                      from pg_catalog.pg_stat_activity as activity
                     where activity.pid <> pg_catalog.pg_backend_pid()
                       and activity.state = 'active'
                       and pg_catalog.strpos(
                         pg_catalog.lower(activity.query),
                         pg_catalog.lower(operation_names[expected.position])
                       ) > 0
                       and case
                         when require_sleep
                           then activity.wait_event = 'PgSleep'
                         else activity.wait_event_type = 'Lock'
                       end
                  ) <> expected_waiters[expected.position]
            );
        $body$
      $definition$;
      execute 'revoke all on function public.phase2c_test_concurrency_probe(text[], integer[], boolean) from public, anon, authenticated';
      execute 'grant execute on function public.phase2c_test_concurrency_probe(text[], integer[], boolean) to service_role';

      execute $definition$
        create function public.phase2c_test_hold_invitation_chain(
          target_job_id uuid,
          hold_ms integer
        )
        returns void
        language plpgsql
        volatile
        security definer
        set search_path = ''
        as $body$
        declare
          target_circle_id uuid;
          target_invitation_id uuid;
          target_requester_auth_user_id uuid;
          target_recipient_auth_user_id uuid;
        begin
          if hold_ms not between 1 and 15000 then
            raise exception using errcode = '42501', message = 'Test lock unavailable';
          end if;

          select job.circle_id,
                 job.invitation_id,
                 requester.user_id,
                 job.target_auth_user_id
            into target_circle_id,
                 target_invitation_id,
                 target_requester_auth_user_id,
                 target_recipient_auth_user_id
            from private.invitation_jobs as job
            join public.circle_memberships as requester
              on requester.circle_id = job.circle_id
             and requester.id = job.requested_by_membership_id
           where job.id = target_job_id;

          if target_circle_id is null
            or not exists (
              select 1
                from auth.users as auth_user
               where auth_user.id = target_recipient_auth_user_id
                 and auth_user.email like '%@example.test'
            ) then
            raise exception using errcode = '42501', message = 'Test lock unavailable';
          end if;

          perform auth_user.id
            from auth.users as auth_user
           where auth_user.id in (
             target_requester_auth_user_id,
             target_recipient_auth_user_id
           )
           order by auth_user.id
           for update;
          perform 1
            from public.circles as circle
           where circle.id = target_circle_id
           for update;
          perform 1
            from private.invitation_jobs as job
           where job.id = target_job_id
           for update;
          if target_invitation_id is not null then
            perform 1
              from private.invitations as invitation
             where invitation.id = target_invitation_id
             for update;
          end if;
          perform pg_catalog.pg_sleep(hold_ms::double precision / 1000);
        end
        $body$
      $definition$;
      execute 'revoke all on function public.phase2c_test_hold_invitation_chain(uuid, integer) from public, anon, authenticated';
      execute 'grant execute on function public.phase2c_test_hold_invitation_chain(uuid, integer) to service_role';

      execute $definition$
        create function public.phase2c_test_materialize_target_bound_invitation_job(
          requested_job_id uuid,
          requested_delivery_version integer,
          requested_token_sha256_hex text
        )
        returns table (
          job_id uuid,
          invitation_id uuid,
          state text,
          delivery_version integer,
          expires_at timestamptz
        )
        language sql
        volatile
        security definer
        set search_path = ''
        as $body$
          select *
            from private.materialize_target_bound_invitation_job(
              requested_job_id,
              requested_delivery_version,
              requested_token_sha256_hex
            );
        $body$
      $definition$;
      execute 'revoke all on function public.phase2c_test_materialize_target_bound_invitation_job(uuid, integer, text) from public, anon, authenticated';
      execute 'grant execute on function public.phase2c_test_materialize_target_bound_invitation_job(uuid, integer, text) to service_role';

      execute $definition$
        create function public.phase2c_test_load_target_bound_invitation_job(
          requested_job_id uuid
        )
        returns table (
          job_id uuid,
          circle_id uuid,
          requester_membership_id uuid,
          requester_authorization_version timestamptz,
          target_auth_user_id uuid,
          invited_display_name text,
          state text,
          token_key_version smallint,
          delivery_version integer,
          requested_at timestamptz,
          expires_at timestamptz
        )
        language sql
        volatile
        security definer
        set search_path = ''
        as $body$
          select *
            from private.load_target_bound_invitation_job(requested_job_id);
        $body$
      $definition$;
      execute 'revoke all on function public.phase2c_test_load_target_bound_invitation_job(uuid) from public, anon, authenticated';
      execute 'grant execute on function public.phase2c_test_load_target_bound_invitation_job(uuid) to service_role';

      execute $definition$
        create function public.phase2c_test_demotion_set_membership_role(
          membership_id uuid,
          role text
        )
        returns void
        language sql
        volatile
        security invoker
        set search_path = ''
        as $body$
          select public.set_membership_role(membership_id, role);
        $body$
      $definition$;
      execute 'revoke all on function public.phase2c_test_demotion_set_membership_role(uuid, text) from public, anon, authenticated, service_role';
      execute 'grant execute on function public.phase2c_test_demotion_set_membership_role(uuid, text) to authenticated';

      execute $definition$
        create function public.phase2c_test_activation_accept_target_bound(
          token text
        )
        returns uuid
        language sql
        volatile
        security invoker
        set search_path = ''
        as $body$
          select public.accept_invitation(token);
        $body$
      $definition$;
      execute 'revoke all on function public.phase2c_test_activation_accept_target_bound(text) from public, anon, authenticated, service_role';
      execute 'grant execute on function public.phase2c_test_activation_accept_target_bound(text) to authenticated';

      execute $definition$
        create function public.phase2c_test_activation_accept_legacy(
          token text
        )
        returns uuid
        language sql
        volatile
        security invoker
        set search_path = ''
        as $body$
          select public.accept_invitation(token);
        $body$
      $definition$;
      execute 'revoke all on function public.phase2c_test_activation_accept_legacy(text) from public, anon, authenticated, service_role';
      execute 'grant execute on function public.phase2c_test_activation_accept_legacy(text) to authenticated';

      execute $definition$
        create function public.phase2c_test_withdrawal_accept(token text)
        returns uuid
        language sql
        volatile
        security invoker
        set search_path = ''
        as $body$
          select public.accept_invitation(token);
        $body$
      $definition$;
      execute 'revoke all on function public.phase2c_test_withdrawal_accept(text) from public, anon, authenticated, service_role';
      execute 'grant execute on function public.phase2c_test_withdrawal_accept(text) to authenticated';

      execute $definition$
        create function public.phase2c_test_withdrawal_revoke(
          invitation_id uuid
        )
        returns void
        language sql
        volatile
        security invoker
        set search_path = ''
        as $body$
          select public.revoke_invitation(invitation_id);
        $body$
      $definition$;
      execute 'revoke all on function public.phase2c_test_withdrawal_revoke(uuid) from public, anon, authenticated, service_role';
      execute 'grant execute on function public.phase2c_test_withdrawal_revoke(uuid) to authenticated';

      execute $definition$
        create function public.phase2c_test_closure_accept(token text)
        returns uuid
        language sql
        volatile
        security invoker
        set search_path = ''
        as $body$
          select public.accept_invitation(token);
        $body$
      $definition$;
      execute 'revoke all on function public.phase2c_test_closure_accept(text) from public, anon, authenticated, service_role';
      execute 'grant execute on function public.phase2c_test_closure_accept(text) to authenticated';

      execute $definition$
        create function public.phase2c_test_closure_request(
          request_key uuid
        )
        returns uuid
        language sql
        volatile
        security invoker
        set search_path = ''
        as $body$
          select public.request_account_closure(request_key);
        $body$
      $definition$;
      execute 'revoke all on function public.phase2c_test_closure_request(uuid) from public, anon, authenticated, service_role';
      execute 'grant execute on function public.phase2c_test_closure_request(uuid) to authenticated';
    end
    $install$;
  `);

  await waitForConcurrencyProbe({
    apiKey,
    apiUrl,
    expectedWaiters: 0,
    label: "The concurrency probe schema cache",
    operationNames: ["phase2-schema-ready"],
    serviceKey,
  });

  const results = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_B,
    holderToken: organizerToken,
    operationName: "revoke_membership",
    requests: [
      () =>
        request(apiUrl, apiKey, organizerToken, "rpc/revoke_membership", {
          body: JSON.stringify({ membership_id: DUAL_ORGANIZER_B_MEMBERSHIP }),
          method: "POST",
        }),
      () =>
        request(apiUrl, apiKey, dualOrganizerToken, "rpc/revoke_membership", {
          body: JSON.stringify({ membership_id: ORGANIZER_B_MEMBERSHIP }),
          method: "POST",
        }),
    ],
    serviceKey,
  });

  const successes = results.filter((response) => response.ok);
  const denials = results.filter((response) => !response.ok);

  if (successes.length !== 1 || denials.length !== 1) {
    throw new Error(
      `Expected one concurrent revocation to succeed and one to fail; received statuses ${results
        .map((response) => response.status)
        .join(", ")}.`,
    );
  }

  const denialBody = await denials[0].json();
  const safeDenials = new Set([
    "22023:Access could not be changed",
    "23514:A circle must retain an active organizer",
  ]);
  if (!safeDenials.has(`${denialBody.code}:${denialBody.message}`)) {
    throw new Error(
      `The losing concurrent request did not follow a safe denial path (${denialBody.code}).`,
    );
  }

  const circleBVisibility = await Promise.all([
    request(
      apiUrl,
      apiKey,
      organizerToken,
      "circles?id=eq.20000000-0000-4000-8000-000000000002&select=id",
    ),
    request(
      apiUrl,
      apiKey,
      dualOrganizerToken,
      "circles?id=eq.20000000-0000-4000-8000-000000000002&select=id",
    ),
  ]);
  const circleBCounts = await Promise.all(
    circleBVisibility.map(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Circle visibility check failed with ${response.status}.`,
        );
      }
      return (await response.json()).length;
    }),
  );

  if (circleBCounts.sort().join(",") !== "0,1") {
    throw new Error(
      `Expected exactly one surviving circle B organizer; received visibility counts ${circleBCounts.join(",")}.`,
    );
  }

  const suffix = randomUUID();
  const invitedEmail = `concurrent-invite-${suffix}@example.test`;
  const createdUser = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "/auth/v1/admin/users",
    {
      body: JSON.stringify({ email: invitedEmail, email_confirm: true }),
      method: "POST",
    },
  );
  if (!createdUser.response.ok || !createdUser.body?.id) {
    throw new Error(
      `Concurrent invite test user creation failed with ${createdUser.response.status}.`,
    );
  }

  const invitation = await jsonRequest(
    apiUrl,
    apiKey,
    organizerAToken,
    "rpc/create_invitation",
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        display_name: `Concurrent Invite ${suffix}`,
        email: invitedEmail,
      }),
      method: "POST",
    },
  );
  const invitationResult = invitation.body?.[0];
  if (
    !invitation.response.ok ||
    typeof invitationResult?.invitation_id !== "string" ||
    typeof invitationResult?.raw_token !== "string"
  ) {
    throw new Error(
      `Concurrent invitation creation failed with ${invitation.response.status}.`,
    );
  }

  const firstAcceptanceToken = createLocalUserToken(
    createdUser.body.id,
    jwtSecret,
  );
  const secondAcceptanceToken = createLocalUserToken(
    createdUser.body.id,
    jwtSecret,
  );
  if (firstAcceptanceToken === secondAcceptanceToken) {
    throw new Error("Concurrent acceptance tokens were not independent.");
  }

  const acceptanceResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "accept_invitation",
    requests: [firstAcceptanceToken, secondAcceptanceToken].map(
      (token) => () =>
        jsonRequest(apiUrl, apiKey, token, "rpc/accept_invitation", {
          body: JSON.stringify({ token: invitationResult.raw_token }),
          method: "POST",
        }),
    ),
    serviceKey,
  });
  const acceptanceSuccesses = acceptanceResults.filter(
    ({ response }) => response.ok,
  );
  const acceptanceDenials = acceptanceResults.filter(
    ({ response }) => !response.ok,
  );
  if (
    acceptanceSuccesses.length !== 1 ||
    acceptanceDenials.length !== 1 ||
    typeof acceptanceSuccesses[0].body !== "string"
  ) {
    throw new Error(
      `Expected one concurrent invitation acceptance and one denial; received statuses ${acceptanceResults
        .map(({ response }) => response.status)
        .join(", ")}.`,
    );
  }
  if (
    acceptanceDenials[0].body?.code !== "22023" ||
    acceptanceDenials[0].body?.message !== "Invitation is not available"
  ) {
    throw new Error(
      "The losing invitation acceptance did not use the generic denial path.",
    );
  }

  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const acceptedMembershipId = acceptanceSuccesses[0].body;
  if (
    !uuid.test(invitationResult.invitation_id) ||
    !uuid.test(createdUser.body.id) ||
    !uuid.test(acceptedMembershipId)
  ) {
    throw new Error(
      "Concurrent invitation results did not contain valid UUIDs.",
    );
  }

  runDatabaseQuery(`
    do $audit$
    declare
      membership_count integer;
      acceptance_audit_count integer;
      accepted_membership uuid;
      accepted_timestamp timestamptz;
    begin
      select count(*)::integer
        into membership_count
        from public.circle_memberships
       where circle_id = '${CIRCLE_A}'::uuid
         and user_id = '${createdUser.body.id}'::uuid;

      select accepted_membership_id, accepted_at
        into accepted_membership, accepted_timestamp
        from private.invitations
       where id = '${invitationResult.invitation_id}'::uuid;

      select count(*)::integer
        into acceptance_audit_count
        from private.audit_events
       where event_type = 'invitation_accepted'
         and subject_type = 'invitation'
         and subject_id = '${invitationResult.invitation_id}'::uuid
         and actor_membership_id = '${acceptedMembershipId}'::uuid;

      if membership_count <> 1
        or accepted_membership <> '${acceptedMembershipId}'::uuid
        or accepted_timestamp is null
        or acceptance_audit_count <> 1 then
        raise exception 'Concurrent invitation acceptance left invalid durable state';
      end if;
    end
    $audit$;
  `);

  const acceptedMembership = await jsonRequest(
    apiUrl,
    apiKey,
    firstAcceptanceToken,
    `circle_memberships?id=eq.${acceptedMembershipId}&select=person_id`,
  );
  const acceptedPersonId = acceptedMembership.body?.[0]?.person_id;
  if (!acceptedMembership.response.ok || !uuid.test(acceptedPersonId)) {
    throw new Error("Concurrent edit membership lookup failed.");
  }

  const createdMoment = await jsonRequest(
    apiUrl,
    apiKey,
    firstAcceptanceToken,
    "rpc/create_written_moment",
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        journal_person_id: acceptedPersonId,
        body: "Concurrent edit starting value.",
        occurred_on: "2026-08-29",
      }),
      method: "POST",
    },
  );
  if (!createdMoment.response.ok || !uuid.test(createdMoment.body)) {
    throw new Error(
      `Concurrent edit setup failed with ${createdMoment.response.status}.`,
    );
  }

  const editBodies = [
    "First concurrent edit wins alone.",
    "Second concurrent edit wins alone.",
  ];
  const editResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "update_written_moment",
    requests: [firstAcceptanceToken, secondAcceptanceToken].map(
      (token, index) => () =>
        jsonRequest(apiUrl, apiKey, token, "rpc/update_written_moment", {
          body: JSON.stringify({
            moment_id: createdMoment.body,
            expected_revision: 1,
            body: editBodies[index],
            occurred_on: "2026-08-29",
          }),
          method: "POST",
        }),
    ),
    serviceKey,
  });
  const editSuccesses = editResults.filter(({ response }) => response.ok);
  const editConflicts = editResults.filter(({ response }) => !response.ok);
  if (
    editSuccesses.length !== 1 ||
    editSuccesses[0].body !== 2 ||
    editConflicts.length !== 1 ||
    editConflicts[0].body?.code !== "40001" ||
    editConflicts[0].body?.message !== "Moment changed elsewhere"
  ) {
    throw new Error(
      `Expected one concurrent edit and one revision conflict; received statuses ${editResults
        .map(({ response }) => response.status)
        .join(", ")}.`,
    );
  }

  runDatabaseQuery(`
    do $moment_audit$
    declare
      durable_body text;
      durable_revision bigint;
      edit_audit_count integer;
    begin
      select body, revision
        into durable_body, durable_revision
        from public.moments
       where id = '${createdMoment.body}'::uuid;

      select count(*)::integer
        into edit_audit_count
        from private.audit_events
       where event_type = 'moment_updated'
         and subject_type = 'moment'
         and subject_id = '${createdMoment.body}'::uuid;

      if durable_body not in (
          'First concurrent edit wins alone.',
          'Second concurrent edit wins alone.'
        )
        or durable_revision <> 2
        or edit_audit_count <> 1 then
        raise exception 'Concurrent moment edits left invalid durable state';
      end if;
    end
    $moment_audit$;
  `);

  const familyMoment = await jsonRequest(
    apiUrl,
    apiKey,
    firstAcceptanceToken,
    "rpc/create_family_moment",
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        journal_person_id: acceptedPersonId,
        moment_kind: "thought",
        moment_title: null,
        moment_body: "Family context concurrency starting value.",
        place_name: null,
        tagged_person_ids: [],
        occurred_on: "2026-08-29",
      }),
      method: "POST",
    },
  );
  if (!familyMoment.response.ok || !uuid.test(familyMoment.body)) {
    throw new Error(
      `Family moment concurrency setup failed with ${familyMoment.response.status}.`,
    );
  }

  const familyEditBodies = [
    "First family-context edit wins alone.",
    "Second family-context edit wins alone.",
  ];
  const familyEditTags = [
    "30000000-0000-4000-8000-000000000001",
    "30000000-0000-4000-8000-000000000008",
  ];
  const familyEditResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "update_family_moment",
    requests: [firstAcceptanceToken, secondAcceptanceToken].map(
      (token, index) => () =>
        jsonRequest(apiUrl, apiKey, token, "rpc/update_family_moment", {
          body: JSON.stringify({
            moment_id: familyMoment.body,
            expected_revision: 1,
            moment_title: null,
            moment_body: familyEditBodies[index],
            place_name: null,
            tagged_person_ids: [familyEditTags[index]],
            occurred_on: "2026-08-29",
          }),
          method: "POST",
        }),
    ),
    serviceKey,
  });
  const familyEditSuccesses = familyEditResults.filter(
    ({ response }) => response.ok,
  );
  const familyEditConflicts = familyEditResults.filter(
    ({ response }) => !response.ok,
  );
  if (
    familyEditSuccesses.length !== 1 ||
    familyEditSuccesses[0].body !== 2 ||
    familyEditConflicts.length !== 1 ||
    familyEditConflicts[0].body?.code !== "40001" ||
    familyEditConflicts[0].body?.message !== "Moment changed elsewhere"
  ) {
    throw new Error(
      `Expected one atomic family-context edit and one revision conflict; received statuses ${familyEditResults
        .map(({ response }) => response.status)
        .join(", ")}.`,
    );
  }

  runDatabaseQuery(`
    do $family_moment_audit$
    declare
      durable_body text;
      durable_revision bigint;
      durable_tag uuid;
      tag_count integer;
    begin
      select body, revision into durable_body, durable_revision
        from public.moments where id = '${familyMoment.body}'::uuid;
      select count(*)::integer, min(person_id::text)::uuid
        into tag_count, durable_tag
        from public.moment_people
       where moment_id = '${familyMoment.body}'::uuid;

      if durable_body not in (
          'First family-context edit wins alone.',
          'Second family-context edit wins alone.'
        )
        or durable_revision <> 2
        or tag_count <> 1
        or durable_tag not in (
          '30000000-0000-4000-8000-000000000001'::uuid,
          '30000000-0000-4000-8000-000000000008'::uuid
        )
        or (
          durable_body = 'First family-context edit wins alone.'
          and durable_tag <> '30000000-0000-4000-8000-000000000001'::uuid
        )
        or (
          durable_body = 'Second family-context edit wins alone.'
          and durable_tag <> '30000000-0000-4000-8000-000000000008'::uuid
        ) then
        raise exception 'Concurrent family-context edits split moment and tag state';
      end if;
    end
    $family_moment_audit$;
  `);

  const createdNote = await jsonRequest(
    apiUrl,
    apiKey,
    firstAcceptanceToken,
    "rpc/create_moment_note",
    {
      body: JSON.stringify({
        moment_id: familyMoment.body,
        body: "Concurrent note starting value.",
      }),
      method: "POST",
    },
  );
  if (!createdNote.response.ok || !uuid.test(createdNote.body)) {
    throw new Error(
      `Concurrent note setup failed with ${createdNote.response.status}.`,
    );
  }

  const noteBodies = [
    "First concurrent note edit wins alone.",
    "Second concurrent note edit wins alone.",
  ];
  const noteEditResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "update_moment_note",
    requests: [firstAcceptanceToken, secondAcceptanceToken].map(
      (token, index) => () =>
        jsonRequest(apiUrl, apiKey, token, "rpc/update_moment_note", {
          body: JSON.stringify({
            note_id: createdNote.body,
            expected_revision: 1,
            body: noteBodies[index],
          }),
          method: "POST",
        }),
    ),
    serviceKey,
  });
  const noteEditSuccesses = noteEditResults.filter(
    ({ response }) => response.ok,
  );
  const noteEditConflicts = noteEditResults.filter(
    ({ response }) => !response.ok,
  );
  if (
    noteEditSuccesses.length !== 1 ||
    noteEditSuccesses[0].body !== 2 ||
    noteEditConflicts.length !== 1 ||
    noteEditConflicts[0].body?.code !== "40001" ||
    noteEditConflicts[0].body?.message !== "Note changed elsewhere"
  ) {
    throw new Error(
      `Expected one concurrent note edit and one revision conflict; received statuses ${noteEditResults
        .map(({ response }) => response.status)
        .join(", ")}.`,
    );
  }

  const reactionResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "set_moment_reaction",
    requests: ["held-close", "made-me-smile"].map(
      (reactionType, index) => () =>
        jsonRequest(
          apiUrl,
          apiKey,
          index === 0 ? firstAcceptanceToken : secondAcceptanceToken,
          "rpc/set_moment_reaction",
          {
            body: JSON.stringify({
              moment_id: familyMoment.body,
              reaction_type: reactionType,
            }),
            method: "POST",
          },
        ),
    ),
    serviceKey,
  });
  if (
    reactionResults.some(({ response }) => !response.ok) ||
    reactionResults
      .map(({ body }) => body)
      .sort()
      .join(",") !== "1,2"
  ) {
    throw new Error(
      `Concurrent reactions did not serialize as one reversible row (${reactionResults
        .map(({ response }) => response.status)
        .join(", ")}; ${reactionResults
        .map(({ body }) => JSON.stringify(body))
        .join(" | ")}).`,
    );
  }

  runDatabaseQuery(`
    do $family_context_audit$
    declare
      durable_note_body text;
      durable_note_revision bigint;
      note_edit_audit_count integer;
      reaction_count integer;
      reaction_revision bigint;
      reaction_type text;
    begin
      select body, revision into durable_note_body, durable_note_revision
        from public.moment_notes where id = '${createdNote.body}'::uuid;
      select count(*)::integer into note_edit_audit_count
        from private.audit_events
       where event_type = 'moment_note_updated'
         and subject_id = '${createdNote.body}'::uuid;
      select count(*)::integer, max(revision), max(reaction.reaction_type)
        into reaction_count, reaction_revision, reaction_type
        from public.moment_reactions as reaction
       where reaction.moment_id = '${familyMoment.body}'::uuid
         and reaction.author_membership_id = '${acceptedMembershipId}'::uuid;

      if durable_note_body not in (
          'First concurrent note edit wins alone.',
          'Second concurrent note edit wins alone.'
        )
        or durable_note_revision <> 2
        or note_edit_audit_count <> 1
        or reaction_count <> 1
        or reaction_revision <> 2
        or reaction_type not in ('held-close', 'made-me-smile') then
        raise exception 'Concurrent note or response state was not durable and singular';
      end if;
    end
    $family_context_audit$;
  `);

  const parentRaceMoment = await jsonRequest(
    apiUrl,
    apiKey,
    firstAcceptanceToken,
    "rpc/create_family_moment",
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        journal_person_id: acceptedPersonId,
        moment_kind: "thought",
        moment_title: null,
        moment_body: "Parent and child mutation race.",
        place_name: null,
        tagged_person_ids: [],
        occurred_on: "2026-08-29",
      }),
      method: "POST",
    },
  );
  if (!parentRaceMoment.response.ok || !uuid.test(parentRaceMoment.body)) {
    throw new Error("Parent-trash race setup failed.");
  }
  const [racedNote, racedTrash] = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "parent trash/note creation",
    operationNames: ["create_moment_note", "set_written_moment_trashed"],
    requests: [
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          firstAcceptanceToken,
          "rpc/create_moment_note",
          {
            body: JSON.stringify({
              moment_id: parentRaceMoment.body,
              body: "A note racing its parent trash.",
            }),
            method: "POST",
          },
        ),
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          firstAcceptanceToken,
          "rpc/set_written_moment_trashed",
          {
            body: JSON.stringify({
              moment_id: parentRaceMoment.body,
              expected_revision: 1,
              trashed: true,
            }),
            method: "POST",
          },
        ),
    ],
    serviceKey,
  });
  if (
    !racedTrash.response.ok ||
    (!racedNote.response.ok && racedNote.body?.code !== "42501")
  ) {
    throw new Error(
      `Parent-trash race did not end on a safe serialized path (${racedNote.response.status}, ${racedTrash.response.status}).`,
    );
  }
  const hiddenConversation = await jsonRequest(
    apiUrl,
    apiKey,
    organizerAToken,
    "rpc/get_moment_conversation",
    {
      body: JSON.stringify({ moment_id: parentRaceMoment.body }),
      method: "POST",
    },
  );
  if (
    !hiddenConversation.response.ok ||
    !Array.isArray(hiddenConversation.body) ||
    hiddenConversation.body.length !== 0
  ) {
    throw new Error("A parent-trash race left descendants readable.");
  }

  const [revocationRacedNote, revocationResult] = await runOverlappedCircleRace(
    {
      apiKey,
      apiUrl,
      circleId: CIRCLE_A,
      holderToken: organizerAToken,
      operationName: "membership revocation/note creation",
      operationNames: ["create_moment_note", "revoke_membership"],
      requests: [
        () =>
          jsonRequest(
            apiUrl,
            apiKey,
            firstAcceptanceToken,
            "rpc/create_moment_note",
            {
              body: JSON.stringify({
                moment_id: "60000000-0000-4000-8000-000000000001",
                body: "A note racing membership revocation.",
              }),
              method: "POST",
            },
          ),
        () =>
          jsonRequest(
            apiUrl,
            apiKey,
            organizerAToken,
            "rpc/revoke_membership",
            {
              body: JSON.stringify({ membership_id: acceptedMembershipId }),
              method: "POST",
            },
          ),
      ],
      serviceKey,
    },
  );
  if (
    !revocationResult.response.ok ||
    (!revocationRacedNote.response.ok &&
      revocationRacedNote.body?.code !== "42501")
  ) {
    throw new Error(
      `Revocation race did not end on a safe serialized path (${revocationRacedNote.response.status}, ${revocationResult.response.status}).`,
    );
  }
  const revokedVisibility = await jsonRequest(
    apiUrl,
    apiKey,
    firstAcceptanceToken,
    "moment_notes?select=id",
  );
  if (
    !revokedVisibility.response.ok ||
    !Array.isArray(revokedVisibility.body) ||
    revokedVisibility.body.length !== 0
  ) {
    throw new Error("A revocation race left descendant rows readable.");
  }

  const guardianResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "set_person_guardian",
    requests: [organizerAToken, organizerATwoToken].map(
      (token) => () =>
        jsonRequest(apiUrl, apiKey, token, "rpc/set_person_guardian", {
          body: JSON.stringify({
            managed_person_id: MANAGED_CHILD_A,
            guardian_membership_id: MEMBER_A_MEMBERSHIP,
            grant_access: true,
          }),
          method: "POST",
        }),
    ),
    serviceKey,
  });
  if (
    guardianResults.some(({ response }) => !response.ok) ||
    !uuid.test(guardianResults[0].body) ||
    guardianResults[0].body !== guardianResults[1].body
  ) {
    throw new Error(
      `Concurrent guardian grants were not idempotent (${guardianResults
        .map(
          ({ response, body }) => `${response.status}:${JSON.stringify(body)}`,
        )
        .join(", ")}).`,
    );
  }

  runDatabaseQuery(`
    do $guardian_audit$
    declare
      active_grant_count integer;
      added_audit_count integer;
    begin
      select count(*)::integer into active_grant_count
        from public.person_guardians
       where circle_id = '${CIRCLE_A}'::uuid
         and managed_person_id = '${MANAGED_CHILD_A}'::uuid
         and guardian_membership_id = '${MEMBER_A_MEMBERSHIP}'::uuid
         and revoked_at is null;
      select count(*)::integer into added_audit_count
        from private.audit_events
       where event_type = 'guardian_added'
         and subject_id = '${guardianResults[0].body}'::uuid;

      if active_grant_count <> 1 or added_audit_count <> 1 then
        raise exception 'Concurrent guardian grants left duplicate durable state or audit history';
      end if;
    end
    $guardian_audit$;
  `);

  const clearGuardianBeforeRevocationRace = await jsonRequest(
    apiUrl,
    apiKey,
    organizerAToken,
    "rpc/set_person_guardian",
    {
      body: JSON.stringify({
        managed_person_id: MANAGED_CHILD_A,
        guardian_membership_id: MEMBER_A_MEMBERSHIP,
        grant_access: false,
      }),
      method: "POST",
    },
  );
  if (!clearGuardianBeforeRevocationRace.response.ok) {
    throw new Error(
      "Guardian/revocation race setup could not clear the grant.",
    );
  }

  const guardianRevocationResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "guardian grant/membership revocation",
    operationNames: ["set_person_guardian", "revoke_membership"],
    requests: [
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerAToken,
          "rpc/set_person_guardian",
          {
            body: JSON.stringify({
              managed_person_id: MANAGED_CHILD_A,
              guardian_membership_id: MEMBER_A_MEMBERSHIP,
              grant_access: true,
            }),
            method: "POST",
          },
        ),
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerATwoToken,
          "rpc/revoke_membership",
          {
            body: JSON.stringify({ membership_id: MEMBER_A_MEMBERSHIP }),
            method: "POST",
          },
        ),
    ],
    serviceKey,
  });
  const [guardianRaceGrant, guardianRaceRevocation] = guardianRevocationResults;
  if (
    !guardianRaceRevocation.response.ok ||
    (!guardianRaceGrant.response.ok &&
      (guardianRaceGrant.body?.code !== "22023" ||
        guardianRaceGrant.body?.message !==
          "Guardian access could not be changed"))
  ) {
    throw new Error(
      `Guardian/revocation race did not use a safe serialized path (${guardianRaceGrant.response.status}, ${guardianRaceRevocation.response.status}).`,
    );
  }

  runDatabaseQuery(`
    do $guardian_revocation_audit$
    declare
      membership_status text;
      active_grant_count integer;
      revocation_audit_count integer;
    begin
      select status into membership_status
        from public.circle_memberships
       where id = '${MEMBER_A_MEMBERSHIP}'::uuid;
      select count(*)::integer into active_grant_count
        from public.person_guardians
       where circle_id = '${CIRCLE_A}'::uuid
         and guardian_membership_id = '${MEMBER_A_MEMBERSHIP}'::uuid
         and revoked_at is null;
      select count(*)::integer into revocation_audit_count
        from private.audit_events
       where event_type = 'membership_revoked'
         and subject_id = '${MEMBER_A_MEMBERSHIP}'::uuid;

      if membership_status <> 'revoked'
        or active_grant_count <> 0
        or revocation_audit_count <> 1 then
        raise exception 'Guardian/revocation race left stale care authority or audit state';
      end if;
    end
    $guardian_revocation_audit$;
  `);

  const invitationJobSuffix = randomUUID();
  const invitationJobTarget = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "/auth/v1/admin/users",
    {
      body: JSON.stringify({
        email: `invitation-job-${invitationJobSuffix}@example.test`,
        email_confirm: true,
      }),
      method: "POST",
    },
  );
  if (
    !invitationJobTarget.response.ok ||
    !uuid.test(invitationJobTarget.body?.id)
  ) {
    throw new Error(
      `Invitation-job concurrency target creation failed with ${invitationJobTarget.response.status}.`,
    );
  }

  const invitationJobRequestKeys = [randomUUID(), randomUUID()];
  const invitationJobDisplayName = `Invitation Job ${invitationJobSuffix}`;
  const duplicateInvitationJobResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "request_invitation_job",
    requests: invitationJobRequestKeys.map(
      (requestKey) => () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerAToken,
          "rpc/request_invitation_job",
          {
            body: JSON.stringify({
              circle_id: CIRCLE_A,
              target_auth_user_id: invitationJobTarget.body.id,
              display_name: invitationJobDisplayName,
              request_key: requestKey,
            }),
            method: "POST",
          },
        ),
    ),
    serviceKey,
  });
  if (
    duplicateInvitationJobResults.some(({ response }) => !response.ok) ||
    !uuid.test(duplicateInvitationJobResults[0].body) ||
    duplicateInvitationJobResults[0].body !==
      duplicateInvitationJobResults[1].body
  ) {
    throw new Error(
      `Distinct invitation-job request keys did not converge on one job (${duplicateInvitationJobResults
        .map(
          ({ response, body }) => `${response.status}:${JSON.stringify(body)}`,
        )
        .join(", ")}).`,
    );
  }

  runDatabaseQuery(`
    do $duplicate_invitation_job_audit$
    declare
      job_count integer;
      queued_job_count integer;
      authorized_job_count integer;
      audit_count integer;
      durable_job_id uuid;
      durable_request_key uuid;
    begin
      select count(*)::integer,
             count(*) filter (where state = 'queued')::integer,
             count(*) filter (
               where private.invitation_job_requester_is_authorized(id)
             )::integer,
             min(id::text)::uuid,
             min(request_key::text)::uuid
        into job_count,
             queued_job_count,
             authorized_job_count,
             durable_job_id,
             durable_request_key
        from private.invitation_jobs
       where circle_id = '${CIRCLE_A}'::uuid
         and target_auth_user_id = '${invitationJobTarget.body.id}'::uuid;

      select count(*)::integer into audit_count
        from private.audit_events
       where circle_id = '${CIRCLE_A}'::uuid
         and event_type = 'invitation_job_requested'
         and subject_type = 'invitation_job'
         and subject_id = '${duplicateInvitationJobResults[0].body}'::uuid;

      if job_count <> 1
        or queued_job_count <> 1
        or authorized_job_count <> 1
        or audit_count <> 1
        or durable_job_id <> '${duplicateInvitationJobResults[0].body}'::uuid
        or durable_request_key not in (
          '${invitationJobRequestKeys[0]}'::uuid,
          '${invitationJobRequestKeys[1]}'::uuid
        ) then
        raise exception 'Distinct invitation-job request keys created duplicate or unauthorized durable state';
      end if;
    end
    $duplicate_invitation_job_audit$;
  `);

  const duplicateExportRequestKey = randomUUID();
  const duplicateExportResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "request_family_export",
    requests: [
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerAToken,
          "rpc/request_family_export",
          {
            body: JSON.stringify({
              circle_id: CIRCLE_A,
              request_key: duplicateExportRequestKey,
            }),
            method: "POST",
          },
        ),
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerAToken,
          "rpc/request_family_export",
          {
            body: JSON.stringify({
              circle_id: CIRCLE_A,
              request_key: duplicateExportRequestKey,
            }),
            method: "POST",
          },
        ),
    ],
    serviceKey,
  });
  if (
    duplicateExportResults.some(({ response }) => !response.ok) ||
    duplicateExportResults[0].body !== duplicateExportResults[1].body
  ) {
    throw new Error(
      `Duplicate export requests did not converge on one job (${duplicateExportResults
        .map(
          ({ response, body }) => `${response.status}:${JSON.stringify(body)}`,
        )
        .join(", ")}).`,
    );
  }

  runDatabaseQuery(`
    do $duplicate_export_audit$
    declare
      job_count integer;
      audit_count integer;
      queued_job_count integer;
    begin
      select count(*)::integer,
             count(*) filter (where state = 'queued')::integer
        into job_count, queued_job_count
        from private.export_jobs
       where circle_id = '${CIRCLE_A}'::uuid
         and requested_by_membership_id = '${ORGANIZER_A_MEMBERSHIP}'::uuid
         and request_key = '${duplicateExportRequestKey}'::uuid;
      select count(*)::integer into audit_count
        from private.audit_events as audit
        join private.export_jobs as job
          on job.circle_id = audit.circle_id
         and job.id = audit.subject_id
       where job.circle_id = '${CIRCLE_A}'::uuid
         and job.requested_by_membership_id = '${ORGANIZER_A_MEMBERSHIP}'::uuid
         and job.request_key = '${duplicateExportRequestKey}'::uuid
         and audit.event_type = 'export_requested';

      if job_count <> 1 or queued_job_count <> 1 or audit_count <> 1 then
        raise exception 'Duplicate export requests created duplicate durable state';
      end if;
    end
    $duplicate_export_audit$;
  `);

  const roleResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "set_membership_role",
    requests: [
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerAToken,
          "rpc/set_membership_role",
          {
            body: JSON.stringify({
              membership_id: ORGANIZER_A_TWO_MEMBERSHIP,
              role: "member",
            }),
            method: "POST",
          },
        ),
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerATwoToken,
          "rpc/set_membership_role",
          {
            body: JSON.stringify({
              membership_id: ORGANIZER_A_MEMBERSHIP,
              role: "member",
            }),
            method: "POST",
          },
        ),
    ],
    serviceKey,
  });
  const roleSuccesses = roleResults.filter(({ response }) => response.ok);
  const roleDenials = roleResults.filter(({ response }) => !response.ok);
  if (
    roleSuccesses.length !== 1 ||
    roleDenials.length !== 1 ||
    roleDenials[0].body?.code !== "22023" ||
    roleDenials[0].body?.message !== "Role could not be changed"
  ) {
    throw new Error(
      `Concurrent organizer demotions did not retain exactly one organizer (${roleResults
        .map(
          ({ response, body }) => `${response.status}:${JSON.stringify(body)}`,
        )
        .join(", ")}).`,
    );
  }

  runDatabaseQuery(`
    do $role_audit$
    declare
      organizer_count integer;
      active_account_count integer;
      role_audit_count integer;
    begin
      select count(*) filter (where role = 'organizer')::integer,
             count(*)::integer
        into organizer_count, active_account_count
        from public.circle_memberships
       where circle_id = '${CIRCLE_A}'::uuid
         and id in (
           '${ORGANIZER_A_MEMBERSHIP}'::uuid,
           '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid
         )
         and status = 'active';
      select count(*)::integer into role_audit_count
        from private.audit_events
       where event_type in ('membership_promoted', 'membership_demoted')
         and subject_id in (
           '${ORGANIZER_A_MEMBERSHIP}'::uuid,
           '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid
         );

      if organizer_count <> 1
        or active_account_count <> 2
        or role_audit_count <> 1 then
        raise exception 'Concurrent organizer demotions left invalid role or audit state';
      end if;
    end
    $role_audit$;
  `);

  runDatabaseQuery(`
    update public.circle_memberships
       set role = 'organizer'
     where circle_id = '${CIRCLE_A}'::uuid
       and id in (
         '${ORGANIZER_A_MEMBERSHIP}'::uuid,
         '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid
       );
  `);

  const exportDemotionRequestKey = randomUUID();
  const exportDemotionResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "export request and organizer demotion",
    operationNames: ["request_family_export", "set_membership_role"],
    requests: [
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerATwoToken,
          "rpc/request_family_export",
          {
            body: JSON.stringify({
              circle_id: CIRCLE_A,
              request_key: exportDemotionRequestKey,
            }),
            method: "POST",
          },
        ),
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerAToken,
          "rpc/set_membership_role",
          {
            body: JSON.stringify({
              membership_id: ORGANIZER_A_TWO_MEMBERSHIP,
              role: "member",
            }),
            method: "POST",
          },
        ),
    ],
    serviceKey,
  });
  const [exportRaceRequest, exportRaceDemotion] = exportDemotionResults;
  if (
    !exportRaceDemotion.response.ok ||
    (!exportRaceRequest.response.ok &&
      (exportRaceRequest.body?.code !== "42501" ||
        exportRaceRequest.body?.message !==
          "Family export could not be requested"))
  ) {
    throw new Error(
      `Export request/demotion race did not use a safe serialized path (${exportDemotionResults
        .map(
          ({ response, body }) => `${response.status}:${JSON.stringify(body)}`,
        )
        .join(", ")}).`,
    );
  }

  runDatabaseQuery(`
    do $export_demotion_audit$
    declare
      requester_role text;
      job_count integer;
      audit_count integer;
      authorized_job_count integer;
      invalidation_audit_count integer;
      queued_job_count integer;
    begin
      select role into requester_role
        from public.circle_memberships
       where id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid;
      select count(*)::integer,
             count(*) filter (where state = 'queued')::integer,
             count(*) filter (
               where private.export_job_requester_is_authorized(id)
             )::integer
        into job_count, queued_job_count, authorized_job_count
        from private.export_jobs
       where circle_id = '${CIRCLE_A}'::uuid
         and requested_by_membership_id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid
         and request_key = '${exportDemotionRequestKey}'::uuid;
      select count(*)::integer into audit_count
        from private.audit_events as audit
        join private.export_jobs as job
          on job.circle_id = audit.circle_id
         and job.id = audit.subject_id
       where job.circle_id = '${CIRCLE_A}'::uuid
         and job.requested_by_membership_id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid
         and job.request_key = '${exportDemotionRequestKey}'::uuid
         and audit.event_type = 'export_requested';
      select count(*)::integer into invalidation_audit_count
        from private.audit_events as audit
        join private.export_jobs as job
          on job.circle_id = audit.circle_id
         and job.id = audit.subject_id
       where job.circle_id = '${CIRCLE_A}'::uuid
         and job.requested_by_membership_id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid
         and job.request_key = '${exportDemotionRequestKey}'::uuid
         and audit.event_type = 'export_invalidated';

      if requester_role <> 'member'
        or job_count not in (0, 1)
        or audit_count <> job_count
        or invalidation_audit_count <> job_count
        or queued_job_count <> 0
        or authorized_job_count <> 0 then
        raise exception 'Export request/demotion race left eligible or duplicate state';
      end if;
    end
    $export_demotion_audit$;
  `);

  runDatabaseQuery(`
    update public.circle_memberships
       set role = 'organizer'
     where id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid;
  `);

  const invitationAuthoritySuffix = randomUUID();
  const invitationAuthorityTarget = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "/auth/v1/admin/users",
    {
      body: JSON.stringify({
        email: `invitation-authority-${invitationAuthoritySuffix}@example.test`,
        email_confirm: true,
      }),
      method: "POST",
    },
  );
  if (
    !invitationAuthorityTarget.response.ok ||
    !uuid.test(invitationAuthorityTarget.body?.id)
  ) {
    throw new Error(
      `Invitation authority-race target creation failed with ${invitationAuthorityTarget.response.status}.`,
    );
  }

  const invitationAuthorityRequestKey = randomUUID();
  const invitationAuthorityResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "invitation request and organizer demotion",
    operationNames: ["request_invitation_job", "set_membership_role"],
    requests: [
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerATwoToken,
          "rpc/request_invitation_job",
          {
            body: JSON.stringify({
              circle_id: CIRCLE_A,
              target_auth_user_id: invitationAuthorityTarget.body.id,
              display_name: `Authority Race ${invitationAuthoritySuffix}`,
              request_key: invitationAuthorityRequestKey,
            }),
            method: "POST",
          },
        ),
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerAToken,
          "rpc/set_membership_role",
          {
            body: JSON.stringify({
              membership_id: ORGANIZER_A_TWO_MEMBERSHIP,
              role: "member",
            }),
            method: "POST",
          },
        ),
    ],
    serviceKey,
  });
  const [invitationRaceRequest, invitationRaceDemotion] =
    invitationAuthorityResults;
  if (
    !invitationRaceDemotion.response.ok ||
    (!invitationRaceRequest.response.ok &&
      (invitationRaceRequest.body?.code !== "42501" ||
        invitationRaceRequest.body?.message !==
          "Invitation delivery could not be requested"))
  ) {
    throw new Error(
      `Invitation request/demotion race did not use a safe serialized path (${invitationAuthorityResults
        .map(
          ({ response, body }) => `${response.status}:${JSON.stringify(body)}`,
        )
        .join(", ")}).`,
    );
  }

  runDatabaseQuery(`
    do $invitation_authority_race_audit$
    declare
      requester_role text;
      job_count integer;
      queued_job_count integer;
      authorized_job_count integer;
      request_audit_count integer;
      invalidation_audit_count integer;
    begin
      select role into requester_role
        from public.circle_memberships
       where id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid;

      select count(*)::integer,
             count(*) filter (where state = 'queued')::integer,
             count(*) filter (
               where private.invitation_job_requester_is_authorized(id)
             )::integer
        into job_count, queued_job_count, authorized_job_count
        from private.invitation_jobs
       where circle_id = '${CIRCLE_A}'::uuid
         and requested_by_membership_id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid
         and request_key = '${invitationAuthorityRequestKey}'::uuid;

      select count(*)::integer into request_audit_count
        from private.audit_events as audit
        join private.invitation_jobs as job
          on job.circle_id = audit.circle_id
         and job.id = audit.subject_id
       where job.circle_id = '${CIRCLE_A}'::uuid
         and job.requested_by_membership_id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid
         and job.request_key = '${invitationAuthorityRequestKey}'::uuid
         and audit.event_type = 'invitation_job_requested';

      select count(*)::integer into invalidation_audit_count
        from private.audit_events as audit
        join private.invitation_jobs as job
          on job.circle_id = audit.circle_id
         and job.id = audit.subject_id
       where job.circle_id = '${CIRCLE_A}'::uuid
         and job.requested_by_membership_id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid
         and job.request_key = '${invitationAuthorityRequestKey}'::uuid
         and audit.event_type = 'invitation_job_invalidated';

      if requester_role <> 'member'
        or job_count not in (0, 1)
        or queued_job_count <> 0
        or authorized_job_count <> 0
        or request_audit_count <> job_count
        or invalidation_audit_count <> job_count then
        raise exception 'Invitation request/demotion race left an eligible, duplicate, or unaudited job';
      end if;
    end
    $invitation_authority_race_audit$;
  `);

  const invitationActivationSuffix = randomUUID();
  const invitationActivationEmail = `invitation-activation-${invitationActivationSuffix}@example.test`;
  const invitationActivationTarget = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "/auth/v1/admin/users",
    {
      body: JSON.stringify({
        email: invitationActivationEmail,
        email_confirm: true,
      }),
      method: "POST",
    },
  );
  if (
    !invitationActivationTarget.response.ok ||
    !uuid.test(invitationActivationTarget.body?.id)
  ) {
    throw new Error(
      `Invitation activation-race target creation failed with ${invitationActivationTarget.response.status}.`,
    );
  }

  const activationInvitation = await jsonRequest(
    apiUrl,
    apiKey,
    organizerAToken,
    "rpc/create_invitation",
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        display_name: `Activation Race ${invitationActivationSuffix}`,
        email: invitationActivationEmail,
      }),
      method: "POST",
    },
  );
  const activationInvitationResult = activationInvitation.body?.[0];
  if (
    !activationInvitation.response.ok ||
    !uuid.test(activationInvitationResult?.invitation_id) ||
    typeof activationInvitationResult?.raw_token !== "string"
  ) {
    throw new Error(
      `Invitation activation-race setup failed with ${activationInvitation.response.status}.`,
    );
  }

  const invitationActivationToken = createLocalUserToken(
    invitationActivationTarget.body.id,
    jwtSecret,
  );
  const invitationActivationRequestKey = randomUUID();
  const invitationActivationResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    holderToken: organizerAToken,
    operationName: "invitation job request and target activation",
    operationNames: ["request_invitation_job", "accept_invitation"],
    requests: [
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerAToken,
          "rpc/request_invitation_job",
          {
            body: JSON.stringify({
              circle_id: CIRCLE_A,
              target_auth_user_id: invitationActivationTarget.body.id,
              display_name: `Activation Race ${invitationActivationSuffix}`,
              request_key: invitationActivationRequestKey,
            }),
            method: "POST",
          },
        ),
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          invitationActivationToken,
          "rpc/accept_invitation",
          {
            body: JSON.stringify({
              token: activationInvitationResult.raw_token,
            }),
            method: "POST",
          },
        ),
    ],
    serviceKey,
  });
  const [activationRaceRequest, activationRaceAcceptance] =
    invitationActivationResults;
  if (
    !activationRaceAcceptance.response.ok ||
    !uuid.test(activationRaceAcceptance.body) ||
    (activationRaceRequest.response.ok
      ? !uuid.test(activationRaceRequest.body)
      : activationRaceRequest.body?.code !== "42501" ||
        activationRaceRequest.body?.message !==
          "Invitation delivery could not be requested")
  ) {
    throw new Error(
      `Invitation request/activation race did not use a safe serialized path (${invitationActivationResults
        .map(
          ({ response, body }) => `${response.status}:${JSON.stringify(body)}`,
        )
        .join(", ")}).`,
    );
  }

  runDatabaseQuery(`
    do $invitation_activation_race_audit$
    declare
      active_membership_count integer;
      job_count integer;
      queued_job_count integer;
      authorized_job_count integer;
      request_audit_count integer;
      invalidation_audit_count integer;
    begin
      select count(*)::integer into active_membership_count
        from public.circle_memberships
       where circle_id = '${CIRCLE_A}'::uuid
         and user_id = '${invitationActivationTarget.body.id}'::uuid
         and status = 'active';

      select count(*)::integer,
             count(*) filter (where state = 'queued')::integer,
             count(*) filter (
               where private.invitation_job_requester_is_authorized(id)
             )::integer
        into job_count, queued_job_count, authorized_job_count
        from private.invitation_jobs
       where circle_id = '${CIRCLE_A}'::uuid
         and target_auth_user_id = '${invitationActivationTarget.body.id}'::uuid
         and request_key = '${invitationActivationRequestKey}'::uuid;

      select count(*)::integer into request_audit_count
        from private.audit_events as audit
        join private.invitation_jobs as job
          on job.circle_id = audit.circle_id
         and job.id = audit.subject_id
       where job.circle_id = '${CIRCLE_A}'::uuid
         and job.target_auth_user_id = '${invitationActivationTarget.body.id}'::uuid
         and job.request_key = '${invitationActivationRequestKey}'::uuid
         and audit.event_type = 'invitation_job_requested';

      select count(*)::integer into invalidation_audit_count
        from private.audit_events as audit
        join private.invitation_jobs as job
          on job.circle_id = audit.circle_id
         and job.id = audit.subject_id
       where job.circle_id = '${CIRCLE_A}'::uuid
         and job.target_auth_user_id = '${invitationActivationTarget.body.id}'::uuid
         and job.request_key = '${invitationActivationRequestKey}'::uuid
         and audit.event_type = 'invitation_job_invalidated';

      if active_membership_count <> 1
        or job_count not in (0, 1)
        or queued_job_count <> 0
        or authorized_job_count <> 0
        or request_audit_count <> job_count
        or invalidation_audit_count <> job_count then
        raise exception 'Invitation request/activation race left an eligible, duplicate, or unaudited job';
      end if;
    end
    $invitation_activation_race_audit$;
  `);

  const exactMaterialization = await createTargetBoundJobFixture({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    jwtSecret,
    label: "exact-materialization",
    organizerToken: organizerAToken,
    serviceKey,
  });
  const exactMaterializationResults = await runTargetBoundInvitationRace({
    apiKey,
    apiUrl,
    expectedOperations: {
      phase2c_test_materialize_target_bound_invitation_job: 2,
    },
    jobId: exactMaterialization.jobId,
    label: "exact target-bound materialization",
    requests: [0, 1].map(
      () => () =>
        materializeTargetBoundInvitation(
          apiUrl,
          serviceKey,
          exactMaterialization.jobId,
          exactMaterialization.rawToken,
        ),
    ),
    serviceKey,
  });
  const exactMaterializationRows = exactMaterializationResults.map(
    (result, index) =>
      targetBoundMaterializationRow(
        result,
        `Exact materialization ${index + 1}`,
      ),
  );
  if (
    exactMaterializationRows[0].job_id !== exactMaterialization.jobId ||
    exactMaterializationRows[1].job_id !== exactMaterialization.jobId ||
    exactMaterializationRows[0].invitation_id !==
      exactMaterializationRows[1].invitation_id
  ) {
    throw new Error(
      "Exact concurrent materialization did not converge on one identity.",
    );
  }
  const exactMaterializationInvitationId =
    exactMaterializationRows[0].invitation_id;
  const exactLoad = await loadTargetBoundInvitation(
    apiUrl,
    serviceKey,
    exactMaterialization.jobId,
  );
  const exactLoadRow = targetBoundLoadRow(
    exactLoad,
    "Exact materialization load",
  );
  if (exactLoadRow.job_id !== exactMaterialization.jobId) {
    throw new Error("Exact materialization load changed job identity.");
  }
  runDatabaseQuery(`
    do $phase2c_exact_materialization_audit$
    begin
      if not exists (
          select 1
            from private.invitation_jobs as job
            join private.invitations as invitation
              on invitation.id = job.invitation_id
             and invitation.invitation_job_id = job.id
           where job.id = '${exactMaterialization.jobId}'::uuid
             and job.state = 'materialized'
             and job.delivery_version = 1
             and job.target_auth_user_id =
               '${exactMaterialization.target.id}'::uuid
             and job.invitation_id =
               '${exactMaterializationInvitationId}'::uuid
             and invitation.target_auth_user_id =
               '${exactMaterialization.target.id}'::uuid
             and encode(invitation.token_hash, 'hex') =
               '${sha256Hex(exactMaterialization.rawToken)}'
             and invitation.accepted_at is null
             and invitation.revoked_at is null
        )
        or (select count(*) from private.invitations
             where invitation_job_id =
               '${exactMaterialization.jobId}'::uuid) <> 1
        or (select count(*) from private.audit_events
             where event_type = 'invitation_created'
               and subject_id =
                 '${exactMaterializationInvitationId}'::uuid) <> 1 then
        raise exception 'Exact concurrent materialization lost singular durable identity';
      end if;
    end
    $phase2c_exact_materialization_audit$;
  `);
  requireSuccessfulOutcome(
    await revokeInvitation(
      apiUrl,
      apiKey,
      organizerAToken,
      exactMaterializationInvitationId,
    ),
    "Exact materialization fixture withdrawal",
  );
  requireInvitationDenial(
    await acceptInvitation(
      apiUrl,
      apiKey,
      exactMaterialization.targetToken,
      exactMaterialization.rawToken,
    ),
    "Exact materialization token replay after withdrawal",
  );
  process.stdout.write("Phase 2C exact materialize/materialize race passed.\n");

  const conflictingMaterialization = await createTargetBoundJobFixture({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    jwtSecret,
    label: "conflicting-materialization",
    organizerToken: organizerAToken,
    serviceKey,
  });
  const conflictingTokens = [invitationToken(), invitationToken()];
  const conflictingMaterializationResults = await runTargetBoundInvitationRace({
    apiKey,
    apiUrl,
    expectedOperations: {
      phase2c_test_materialize_target_bound_invitation_job: 2,
    },
    jobId: conflictingMaterialization.jobId,
    label: "conflicting target-bound materialization",
    requests: conflictingTokens.map(
      (rawToken) => () =>
        materializeTargetBoundInvitation(
          apiUrl,
          serviceKey,
          conflictingMaterialization.jobId,
          rawToken,
        ),
    ),
    serviceKey,
  });
  conflictingMaterializationResults.forEach((result, index) =>
    rejectUnsafeOutcome(result, `Conflicting materialization ${index + 1}`),
  );
  const conflictingWinners = conflictingMaterializationResults
    .map((result, index) => ({ index, result }))
    .filter(
      ({ result }) =>
        result.response.ok &&
        Array.isArray(result.body) &&
        result.body.length === 1,
    );
  const conflictingLosers = conflictingMaterializationResults
    .map((result, index) => ({ index, result }))
    .filter(
      ({ result }) =>
        result.response.ok &&
        Array.isArray(result.body) &&
        result.body.length === 0,
    );
  if (conflictingWinners.length !== 1 || conflictingLosers.length !== 1) {
    throw new Error(
      `Conflicting materialization did not select one digest (${conflictingMaterializationResults
        .map(
          ({ response, body }) => `${response.status}:${JSON.stringify(body)}`,
        )
        .join(" | ")}).`,
    );
  }
  const conflictingWinner = conflictingWinners[0];
  const conflictingLoser = conflictingLosers[0];
  const conflictingWinnerRow = targetBoundMaterializationRow(
    conflictingWinner.result,
    "Conflicting materialization winner",
  );
  requireEmptyMaterialization(
    conflictingLoser.result,
    "Conflicting materialization loser",
  );
  const conflictingWinnerToken = conflictingTokens[conflictingWinner.index];
  const conflictingLoserToken = conflictingTokens[conflictingLoser.index];
  const conflictingLoad = targetBoundLoadRow(
    await loadTargetBoundInvitation(
      apiUrl,
      serviceKey,
      conflictingMaterialization.jobId,
    ),
    "Conflicting materialization load",
  );
  if (conflictingLoad.job_id !== conflictingMaterialization.jobId) {
    throw new Error("Conflicting materialization load changed job identity.");
  }
  runDatabaseQuery(`
    do $phase2c_conflicting_materialization_audit$
    begin
      if not exists (
          select 1
            from private.invitation_jobs as job
            join private.invitations as invitation
              on invitation.id = job.invitation_id
             and invitation.invitation_job_id = job.id
           where job.id = '${conflictingMaterialization.jobId}'::uuid
             and job.state = 'materialized'
             and job.invitation_id =
               '${conflictingWinnerRow.invitation_id}'::uuid
             and encode(invitation.token_hash, 'hex') =
               '${sha256Hex(conflictingWinnerToken)}'
             and encode(invitation.token_hash, 'hex') <>
               '${sha256Hex(conflictingLoserToken)}'
             and invitation.target_auth_user_id =
               '${conflictingMaterialization.target.id}'::uuid
        )
        or (select count(*) from private.invitations
             where invitation_job_id =
               '${conflictingMaterialization.jobId}'::uuid) <> 1
        or (select count(*) from private.audit_events
             where event_type = 'invitation_created'
               and subject_id =
                 '${conflictingWinnerRow.invitation_id}'::uuid) <> 1 then
        raise exception 'Conflicting materialization retained ambiguous identity';
      end if;
    end
    $phase2c_conflicting_materialization_audit$;
  `);
  requireSuccessfulOutcome(
    await revokeInvitation(
      apiUrl,
      apiKey,
      organizerAToken,
      conflictingWinnerRow.invitation_id,
    ),
    "Conflicting materialization fixture withdrawal",
  );
  for (const [index, rawToken] of conflictingTokens.entries()) {
    requireInvitationDenial(
      await acceptInvitation(
        apiUrl,
        apiKey,
        conflictingMaterialization.targetToken,
        rawToken,
      ),
      `Conflicting materialization token ${index + 1} replay`,
    );
  }
  process.stdout.write(
    "Phase 2C conflicting materialize/materialize race passed.\n",
  );

  requireSuccessfulOutcome(
    await jsonRequest(
      apiUrl,
      apiKey,
      organizerAToken,
      "rpc/set_membership_role",
      {
        body: JSON.stringify({
          membership_id: ORGANIZER_A_TWO_MEMBERSHIP,
          role: "organizer",
        }),
        method: "POST",
      },
    ),
    "Phase 2C demotion fixture promotion",
  );
  const demotionMaterialization = await createTargetBoundJobFixture({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    jwtSecret,
    label: "materialization-demotion",
    organizerToken: organizerATwoToken,
    serviceKey,
  });
  const [racedDemotionMaterialization, racedRequesterDemotion] =
    await runTargetBoundInvitationRace({
      apiKey,
      apiUrl,
      expectedOperations: {
        phase2c_test_materialize_target_bound_invitation_job: 1,
        phase2c_test_demotion_set_membership_role: 1,
      },
      jobId: demotionMaterialization.jobId,
      label: "target-bound materialization and requester demotion",
      requests: [
        () =>
          materializeTargetBoundInvitation(
            apiUrl,
            serviceKey,
            demotionMaterialization.jobId,
            demotionMaterialization.rawToken,
          ),
        () =>
          jsonRequest(
            apiUrl,
            apiKey,
            organizerAToken,
            "rpc/phase2c_test_demotion_set_membership_role",
            {
              body: JSON.stringify({
                membership_id: ORGANIZER_A_TWO_MEMBERSHIP,
                role: "member",
              }),
              method: "POST",
            },
          ),
      ],
      serviceKey,
    });
  requireSuccessfulOutcome(
    racedRequesterDemotion,
    "Target-bound requester demotion",
  );
  rejectUnsafeOutcome(
    racedDemotionMaterialization,
    "Materialization racing requester demotion",
  );
  if (
    !racedDemotionMaterialization.response.ok ||
    !Array.isArray(racedDemotionMaterialization.body) ||
    ![0, 1].includes(racedDemotionMaterialization.body.length)
  ) {
    throw new Error(
      "Materialization/demotion race did not use a valid serial materialization result.",
    );
  }
  const demotionInvitationId =
    racedDemotionMaterialization.body[0]?.invitation_id ?? null;
  const demotionLoad = await loadTargetBoundInvitation(
    apiUrl,
    serviceKey,
    demotionMaterialization.jobId,
  );
  requireEmptyMaterialization(
    demotionLoad,
    "Materialization/demotion terminal load",
  );
  runDatabaseQuery(`
    do $phase2c_materialization_demotion_audit$
    declare
      linked_invitation_id uuid;
    begin
      select invitation_id into linked_invitation_id
        from private.invitation_jobs
       where id = '${demotionMaterialization.jobId}'::uuid;

      if not exists (
          select 1 from public.circle_memberships
           where id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid
             and role = 'member'
             and status = 'active'
        )
        or not exists (
          select 1 from private.invitation_jobs
           where id = '${demotionMaterialization.jobId}'::uuid
             and state = 'invalidated'
             and invalidation_reason = 'requester_authority_lost'
             and invalidated_by_membership_id =
               '${ORGANIZER_A_MEMBERSHIP}'::uuid
             and invalidated_by_closure_request_id is null
             and not private.invitation_job_requester_is_authorized(id)
        )
        or (select count(*) from private.invitation_jobs
             where id = '${demotionMaterialization.jobId}'::uuid) <> 1
        or (select count(*) from private.audit_events
             where event_type = 'invitation_job_invalidated'
               and subject_id =
                 '${demotionMaterialization.jobId}'::uuid) <> 1
        or (select count(*) from private.audit_events
             where event_type = 'invitation_job_invalidated'
               and subject_id =
                 '${demotionMaterialization.jobId}'::uuid
               and actor_membership_id =
                 '${ORGANIZER_A_MEMBERSHIP}'::uuid) <> 1
        or (select count(*) from private.invitations
             where invitation_job_id =
               '${demotionMaterialization.jobId}'::uuid) <>
                 ${demotionInvitationId ? 1 : 0}
        or (select count(*)
              from private.audit_events as audit
              join private.invitations as invitation
                on invitation.id = audit.subject_id
               and invitation.invitation_job_id =
                 '${demotionMaterialization.jobId}'::uuid
             where audit.event_type = 'invitation_created') <>
                 ${demotionInvitationId ? 1 : 0}
        or (select count(*)
              from private.audit_events as audit
              join private.invitations as invitation
                on invitation.id = audit.subject_id
               and invitation.invitation_job_id =
                 '${demotionMaterialization.jobId}'::uuid
             where audit.event_type = 'invitation_created'
               and audit.actor_membership_id =
                 '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid) <>
                 ${demotionInvitationId ? 1 : 0}
        or (
          linked_invitation_id is not null
          and not exists (
            select 1 from private.invitations
             where id = linked_invitation_id
               and invitation_job_id =
                 '${demotionMaterialization.jobId}'::uuid
               and target_auth_user_id =
                 '${demotionMaterialization.target.id}'::uuid
               and encode(token_hash, 'hex') =
                 '${sha256Hex(demotionMaterialization.rawToken)}'
               and accepted_at is null
               and revoked_at is not null
               and revocation_reason = 'requester_authority_lost'
               and revoked_by_membership_id =
                 '${ORGANIZER_A_MEMBERSHIP}'::uuid
               and revoked_by_closure_request_id is null
          )
        )
        or linked_invitation_id is distinct from
          ${demotionInvitationId ? `'${demotionInvitationId}'::uuid` : "null::uuid"} then
        raise exception 'Materialization/demotion race left live or ambiguous invitation authority';
      end if;
    end
    $phase2c_materialization_demotion_audit$;
  `);
  requireInvitationDenial(
    await acceptInvitation(
      apiUrl,
      apiKey,
      demotionMaterialization.targetToken,
      demotionMaterialization.rawToken,
    ),
    "Materialization/demotion token replay",
  );
  process.stdout.write(
    "Phase 2C materialize/requester-demotion race passed.\n",
  );

  const targetActivationTarget = await createSyntheticAuthUser(
    apiUrl,
    serviceKey,
    "accept-target-activation",
  );
  const targetActivationToken = createLocalUserToken(
    targetActivationTarget.id,
    jwtSecret,
  );
  const targetActivationLegacyInvitation = await jsonRequest(
    apiUrl,
    apiKey,
    organizerAToken,
    "rpc/create_invitation",
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        display_name: "Phase 2C alternate activation",
        email: targetActivationTarget.email,
      }),
      method: "POST",
    },
  );
  requireSuccessfulOutcome(
    targetActivationLegacyInvitation,
    "Target-activation legacy invitation setup",
  );
  const targetActivationLegacyRow = targetActivationLegacyInvitation.body?.[0];
  if (
    !uuid.test(targetActivationLegacyRow?.invitation_id) ||
    typeof targetActivationLegacyRow?.raw_token !== "string"
  ) {
    throw new Error(
      "Target-activation legacy invitation did not return its synthetic identity.",
    );
  }
  const targetActivationJobId = await requestTargetBoundInvitationJob({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    displayName: "Phase 2C accept target activation",
    organizerToken: organizerAToken,
    targetAuthUserId: targetActivationTarget.id,
  });
  const targetActivationRawToken = invitationToken();
  const targetActivationMaterialization = targetBoundMaterializationRow(
    await materializeTargetBoundInvitation(
      apiUrl,
      serviceKey,
      targetActivationJobId,
      targetActivationRawToken,
    ),
    "Target-activation materialization setup",
  );
  const targetActivationAcceptanceResults = await runTargetBoundInvitationRace({
    apiKey,
    apiUrl,
    expectedOperations: {
      phase2c_test_activation_accept_legacy: 1,
      phase2c_test_activation_accept_target_bound: 1,
    },
    jobId: targetActivationJobId,
    label: "target-bound acceptance and alternate target activation",
    requests: [
      () =>
        acceptInvitation(
          apiUrl,
          apiKey,
          targetActivationToken,
          targetActivationRawToken,
          "phase2c_test_activation_accept_target_bound",
        ),
      () =>
        acceptInvitation(
          apiUrl,
          apiKey,
          targetActivationToken,
          targetActivationLegacyRow.raw_token,
          "phase2c_test_activation_accept_legacy",
        ),
    ],
    serviceKey,
  });
  targetActivationAcceptanceResults.forEach((result, index) =>
    rejectUnsafeOutcome(result, `Target-activation acceptance ${index + 1}`),
  );
  const targetActivationSuccesses = targetActivationAcceptanceResults
    .map((result, index) => ({ index, result }))
    .filter(({ result }) => result.response.ok && uuid.test(result.body));
  if (targetActivationSuccesses.length !== 1) {
    throw new Error(
      `Target activation race did not select exactly one membership (${targetActivationAcceptanceResults
        .map(
          ({ response, body }) => `${response.status}:${JSON.stringify(body)}`,
        )
        .join(" | ")}).`,
    );
  }
  const targetBoundAcceptanceWon = targetActivationSuccesses[0].index === 0;
  const targetActivationMembershipId = targetActivationSuccesses[0].result.body;
  requireInvitationDenial(
    targetActivationAcceptanceResults[targetBoundAcceptanceWon ? 1 : 0],
    "Target-activation losing acceptance",
  );
  runDatabaseQuery(`
    do $phase2c_accept_target_activation_audit$
    begin
      if (select count(*) from public.circle_memberships
           where circle_id = '${CIRCLE_A}'::uuid
             and user_id = '${targetActivationTarget.id}'::uuid
             and status = 'active') <> 1
        or not exists (
          select 1 from private.invitation_jobs
           where id = '${targetActivationJobId}'::uuid
             and state = 'invalidated'
             and invalidation_reason =
               '${targetBoundAcceptanceWon ? "target_accepted" : "target_became_active"}'
             and not private.invitation_job_requester_is_authorized(id)
        )
        or not exists (
          select 1 from private.invitations
           where id = '${targetActivationMaterialization.invitation_id}'::uuid
             and invitation_job_id = '${targetActivationJobId}'::uuid
             and (
               (
                 ${targetBoundAcceptanceWon ? "true" : "false"}
                 and accepted_membership_id =
                   '${targetActivationMembershipId}'::uuid
                 and accepted_at is not null
                 and revoked_at is null
               )
               or (
                 ${targetBoundAcceptanceWon ? "false" : "true"}
                 and accepted_at is null
                 and revoked_at is not null
                 and revocation_reason = 'target_became_active'
               )
             )
        )
        or (select count(*) from private.audit_events
             where event_type = 'invitation_job_invalidated'
               and subject_id = '${targetActivationJobId}'::uuid
               and actor_membership_id =
                 '${targetActivationMembershipId}'::uuid) <> 1
        or (select count(*) from private.audit_events
             where event_type = 'invitation_accepted'
               and subject_id =
                 '${targetBoundAcceptanceWon ? targetActivationMaterialization.invitation_id : targetActivationLegacyRow.invitation_id}'::uuid
               and actor_membership_id =
                 '${targetActivationMembershipId}'::uuid) <> 1 then
        raise exception 'Acceptance/target-activation race left split or live invitation state';
      end if;
    end
    $phase2c_accept_target_activation_audit$;
  `);
  requireEmptyMaterialization(
    await loadTargetBoundInvitation(apiUrl, serviceKey, targetActivationJobId),
    "Target-activation terminal load",
  );
  if (targetBoundAcceptanceWon) {
    requireSuccessfulOutcome(
      await revokeInvitation(
        apiUrl,
        apiKey,
        organizerAToken,
        targetActivationLegacyRow.invitation_id,
      ),
      "Target-activation losing legacy invitation cleanup",
    );
  }
  for (const [label, rawToken] of [
    ["target-bound", targetActivationRawToken],
    ["alternate", targetActivationLegacyRow.raw_token],
  ]) {
    requireInvitationDenial(
      await acceptInvitation(apiUrl, apiKey, targetActivationToken, rawToken),
      `Target-activation ${label} token replay`,
    );
  }
  process.stdout.write("Phase 2C accept/target-activation race passed.\n");

  const withdrawalAcceptance = await createTargetBoundJobFixture({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    jwtSecret,
    label: "accept-withdrawal",
    organizerToken: organizerAToken,
    serviceKey,
  });
  const withdrawalMaterialization = targetBoundMaterializationRow(
    await materializeTargetBoundInvitation(
      apiUrl,
      serviceKey,
      withdrawalAcceptance.jobId,
      withdrawalAcceptance.rawToken,
    ),
    "Acceptance/withdrawal materialization setup",
  );
  const [racedWithdrawalAcceptance, racedOrganizerWithdrawal] =
    await runTargetBoundInvitationRace({
      apiKey,
      apiUrl,
      expectedOperations: {
        phase2c_test_withdrawal_accept: 1,
        phase2c_test_withdrawal_revoke: 1,
      },
      jobId: withdrawalAcceptance.jobId,
      label: "target-bound acceptance and organizer withdrawal",
      requests: [
        () =>
          acceptInvitation(
            apiUrl,
            apiKey,
            withdrawalAcceptance.targetToken,
            withdrawalAcceptance.rawToken,
            "phase2c_test_withdrawal_accept",
          ),
        () =>
          revokeInvitation(
            apiUrl,
            apiKey,
            organizerAToken,
            withdrawalMaterialization.invitation_id,
            "phase2c_test_withdrawal_revoke",
          ),
      ],
      serviceKey,
    });
  rejectUnsafeOutcome(
    racedWithdrawalAcceptance,
    "Acceptance racing organizer withdrawal",
  );
  rejectUnsafeOutcome(
    racedOrganizerWithdrawal,
    "Organizer withdrawal racing acceptance",
  );
  const withdrawalAcceptanceWon =
    racedWithdrawalAcceptance.response.ok &&
    uuid.test(racedWithdrawalAcceptance.body);
  const organizerWithdrawalWon = racedOrganizerWithdrawal.response.ok;
  if (withdrawalAcceptanceWon === organizerWithdrawalWon) {
    throw new Error(
      `Acceptance/withdrawal race did not select one terminal action (${racedWithdrawalAcceptance.response.status}:${JSON.stringify(racedWithdrawalAcceptance.body)} | ${racedOrganizerWithdrawal.response.status}:${JSON.stringify(racedOrganizerWithdrawal.body)}).`,
    );
  }
  if (withdrawalAcceptanceWon) {
    requireInvitationChangeDenial(
      racedOrganizerWithdrawal,
      "Withdrawal losing to acceptance",
    );
  } else {
    requireInvitationDenial(
      racedWithdrawalAcceptance,
      "Acceptance losing to withdrawal",
    );
  }
  runDatabaseQuery(`
    do $phase2c_accept_withdrawal_audit$
    begin
      if not exists (
          select 1 from private.invitation_jobs
           where id = '${withdrawalAcceptance.jobId}'::uuid
             and state = 'invalidated'
             and invalidation_reason =
               '${withdrawalAcceptanceWon ? "target_accepted" : "organizer_withdrawn"}'
             and invalidated_by_membership_id =
               '${withdrawalAcceptanceWon ? racedWithdrawalAcceptance.body : ORGANIZER_A_MEMBERSHIP}'::uuid
             and invalidated_by_closure_request_id is null
             and not private.invitation_job_requester_is_authorized(id)
        )
        or not exists (
          select 1 from private.invitations
           where id = '${withdrawalMaterialization.invitation_id}'::uuid
             and invitation_job_id =
               '${withdrawalAcceptance.jobId}'::uuid
             and (
               (
                 ${withdrawalAcceptanceWon ? "true" : "false"}
                 and accepted_membership_id =
                   '${withdrawalAcceptanceWon ? racedWithdrawalAcceptance.body : ORGANIZER_A_MEMBERSHIP}'::uuid
                 and accepted_at is not null
                 and revoked_at is null
                 and revoked_by_membership_id is null
                 and revoked_by_closure_request_id is null
               )
               or (
                 ${withdrawalAcceptanceWon ? "false" : "true"}
                 and accepted_at is null
                 and revoked_at is not null
                 and revocation_reason = 'organizer_withdrawn'
                 and revoked_by_membership_id =
                   '${ORGANIZER_A_MEMBERSHIP}'::uuid
               )
             )
        )
        or (select count(*) from public.circle_memberships
             where circle_id = '${CIRCLE_A}'::uuid
               and user_id = '${withdrawalAcceptance.target.id}'::uuid
               and status = 'active') <>
                 ${withdrawalAcceptanceWon ? 1 : 0}
        or (select count(*) from private.audit_events
             where event_type = 'invitation_job_invalidated'
               and subject_id = '${withdrawalAcceptance.jobId}'::uuid) <> 1
        or (select count(*) from private.audit_events
             where event_type = 'invitation_job_invalidated'
               and subject_id = '${withdrawalAcceptance.jobId}'::uuid
               and actor_membership_id =
                 '${withdrawalAcceptanceWon ? racedWithdrawalAcceptance.body : ORGANIZER_A_MEMBERSHIP}'::uuid) <> 1
        or (select count(*) from private.audit_events
             where event_type = 'invitation_accepted'
               and subject_id =
                 '${withdrawalMaterialization.invitation_id}'::uuid) <>
                   ${withdrawalAcceptanceWon ? 1 : 0}
        or (select count(*) from private.audit_events
             where event_type = 'invitation_accepted'
               and subject_id =
                 '${withdrawalMaterialization.invitation_id}'::uuid
               and actor_membership_id =
                 '${withdrawalAcceptanceWon ? racedWithdrawalAcceptance.body : ORGANIZER_A_MEMBERSHIP}'::uuid) <>
                   ${withdrawalAcceptanceWon ? 1 : 0}
        or (select count(*) from private.audit_events
             where event_type = 'invitation_revoked'
               and subject_id =
                 '${withdrawalMaterialization.invitation_id}'::uuid) <>
                   ${withdrawalAcceptanceWon ? 0 : 1}
        or (select count(*) from private.audit_events
             where event_type = 'invitation_revoked'
               and subject_id =
                 '${withdrawalMaterialization.invitation_id}'::uuid
               and actor_membership_id =
                 '${ORGANIZER_A_MEMBERSHIP}'::uuid) <>
                   ${withdrawalAcceptanceWon ? 0 : 1} then
        raise exception 'Acceptance/withdrawal race left mismatched durable state';
      end if;
    end
    $phase2c_accept_withdrawal_audit$;
  `);
  requireEmptyMaterialization(
    await loadTargetBoundInvitation(
      apiUrl,
      serviceKey,
      withdrawalAcceptance.jobId,
    ),
    "Acceptance/withdrawal terminal load",
  );
  requireInvitationDenial(
    await acceptInvitation(
      apiUrl,
      apiKey,
      withdrawalAcceptance.targetToken,
      withdrawalAcceptance.rawToken,
    ),
    "Acceptance/withdrawal token replay",
  );
  process.stdout.write("Phase 2C accept/organizer-withdrawal race passed.\n");

  const closureAcceptance = await createTargetBoundJobFixture({
    apiKey,
    apiUrl,
    circleId: CIRCLE_A,
    jwtSecret,
    label: "accept-closure",
    organizerToken: organizerAToken,
    serviceKey,
  });
  const closureCircleBPersonId = randomUUID();
  const closureCircleBMembershipId = randomUUID();
  runDatabaseQuery(`
    insert into public.people (
      id, circle_id, display_name, profile_kind, created_by_membership_id
    ) values (
      '${closureCircleBPersonId}'::uuid,
      '${CIRCLE_B}'::uuid,
      'Phase 2C closure target',
      'account',
      '${ORGANIZER_B_MEMBERSHIP}'::uuid
    )
  `);
  runDatabaseQuery(`
    insert into public.circle_memberships (
      id, circle_id, user_id, person_id, role, status
    ) values (
      '${closureCircleBMembershipId}'::uuid,
      '${CIRCLE_B}'::uuid,
      '${closureAcceptance.target.id}'::uuid,
      '${closureCircleBPersonId}'::uuid,
      'member',
      'active'
    )
  `);
  const closureMaterialization = targetBoundMaterializationRow(
    await materializeTargetBoundInvitation(
      apiUrl,
      serviceKey,
      closureAcceptance.jobId,
      closureAcceptance.rawToken,
    ),
    "Acceptance/closure materialization setup",
  );
  const closureRequestKey = randomUUID();
  const [racedClosureAcceptance, racedTargetClosure] =
    await runTargetBoundInvitationRace({
      apiKey,
      apiUrl,
      expectedOperations: {
        phase2c_test_closure_accept: 1,
        phase2c_test_closure_request: 1,
      },
      jobId: closureAcceptance.jobId,
      label: "target-bound acceptance and target closure",
      requests: [
        () =>
          acceptInvitation(
            apiUrl,
            apiKey,
            closureAcceptance.targetToken,
            closureAcceptance.rawToken,
            "phase2c_test_closure_accept",
          ),
        () =>
          jsonRequest(
            apiUrl,
            apiKey,
            closureAcceptance.targetToken,
            "rpc/phase2c_test_closure_request",
            {
              body: JSON.stringify({ request_key: closureRequestKey }),
              method: "POST",
            },
          ),
      ],
      serviceKey,
    });
  const targetClosureId = requireSuccessfulOutcome(
    racedTargetClosure,
    "Target closure racing invitation acceptance",
  );
  if (!uuid.test(targetClosureId)) {
    throw new Error("Acceptance/closure race did not return a closure ID.");
  }
  rejectUnsafeOutcome(
    racedClosureAcceptance,
    "Invitation acceptance racing target closure",
  );
  const closureAcceptanceWon =
    racedClosureAcceptance.response.ok &&
    uuid.test(racedClosureAcceptance.body);
  if (!closureAcceptanceWon) {
    requireInvitationDenial(
      racedClosureAcceptance,
      "Acceptance losing to target closure",
    );
  }
  runDatabaseQuery(`
    do $phase2c_accept_closure_request_audit$
    begin
      if not private.account_closure_is_blocking(
          '${closureAcceptance.target.id}'::uuid
        )
        or not exists (
          select 1 from private.account_closure_requests
           where id = '${targetClosureId}'::uuid
             and auth_user_id = '${closureAcceptance.target.id}'::uuid
             and request_key = '${closureRequestKey}'::uuid
             and state = 'requested'
        )
        or not exists (
          select 1 from private.invitation_jobs
           where id = '${closureAcceptance.jobId}'::uuid
             and state = 'invalidated'
             and invalidation_reason =
               '${closureAcceptanceWon ? "target_accepted" : "account_closure"}'
             and (
               ${closureAcceptanceWon ? `invalidated_by_membership_id = '${racedClosureAcceptance.body}'::uuid` : "invalidated_by_membership_id is null"}
             )
             and (
               ${closureAcceptanceWon ? "invalidated_by_closure_request_id is null" : `invalidated_by_closure_request_id = '${targetClosureId}'::uuid`}
             )
             and not private.invitation_job_requester_is_authorized(id)
        )
        or not exists (
          select 1 from private.invitations
           where id = '${closureMaterialization.invitation_id}'::uuid
             and invitation_job_id = '${closureAcceptance.jobId}'::uuid
             and (
               (
                 ${closureAcceptanceWon ? "true" : "false"}
                 and accepted_membership_id =
                   '${closureAcceptanceWon ? racedClosureAcceptance.body : ORGANIZER_A_MEMBERSHIP}'::uuid
                 and accepted_at is not null
                 and revoked_at is null
                 and revoked_by_membership_id is null
                 and revoked_by_closure_request_id is null
               )
               or (
                 ${closureAcceptanceWon ? "false" : "true"}
                 and accepted_at is null
                 and revoked_at is not null
                 and revocation_reason = 'account_closure'
                 and revoked_by_membership_id is null
                 and revoked_by_closure_request_id =
                   '${targetClosureId}'::uuid
               )
             )
        )
        or (select count(*) from public.circle_memberships
             where circle_id = '${CIRCLE_A}'::uuid
               and user_id = '${closureAcceptance.target.id}'::uuid
               and status = 'active') <>
                 ${closureAcceptanceWon ? 1 : 0}
        or (select count(*) from private.audit_events
             where event_type = 'invitation_job_invalidated'
               and subject_id = '${closureAcceptance.jobId}'::uuid) <> 1
        or (select count(*) from private.audit_events
             where event_type = 'invitation_job_invalidated'
               and subject_id = '${closureAcceptance.jobId}'::uuid
               and (
                 ${closureAcceptanceWon ? `actor_membership_id = '${racedClosureAcceptance.body}'::uuid` : "actor_membership_id is null"}
               )) <> 1
        or (select count(*) from private.audit_events
             where event_type = 'invitation_accepted'
               and subject_id =
                 '${closureMaterialization.invitation_id}'::uuid) <>
                   ${closureAcceptanceWon ? 1 : 0}
        or (select count(*) from private.audit_events
             where event_type = 'invitation_accepted'
               and subject_id =
                 '${closureMaterialization.invitation_id}'::uuid
               and actor_membership_id =
                 '${closureAcceptanceWon ? racedClosureAcceptance.body : ORGANIZER_A_MEMBERSHIP}'::uuid) <>
                   ${closureAcceptanceWon ? 1 : 0}
        or (select count(*) from private.audit_events
             where event_type = 'invitation_revoked'
               and subject_id =
                 '${closureMaterialization.invitation_id}'::uuid) <> 0 then
        raise exception 'Acceptance/closure request race left a live or falsely attributed invitation';
      end if;
    end
    $phase2c_accept_closure_request_audit$;
  `);
  requireEmptyMaterialization(
    await loadTargetBoundInvitation(
      apiUrl,
      serviceKey,
      closureAcceptance.jobId,
    ),
    "Acceptance/closure terminal load",
  );
  requireInvitationDenial(
    await acceptInvitation(
      apiUrl,
      apiKey,
      closureAcceptance.targetToken,
      closureAcceptance.rawToken,
    ),
    "Acceptance/closure token replay",
  );
  const preparedTargetClosure = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "rpc/phase7c_test_prepare_account_closure",
    {
      body: JSON.stringify({ closure_request_id: targetClosureId }),
      method: "POST",
    },
  );
  requireSuccessfulOutcome(
    preparedTargetClosure,
    "Acceptance/closure preparation",
  );
  if (preparedTargetClosure.body !== targetClosureId) {
    throw new Error("Acceptance/closure preparation changed closure identity.");
  }
  runDatabaseQuery(`
    do $phase2c_accept_closure_prepared_audit$
    begin
      if not exists (
          select 1 from private.account_closure_requests
           where id = '${targetClosureId}'::uuid
             and state = 'prepared'
        )
        or exists (
          select 1 from public.circle_memberships
           where user_id = '${closureAcceptance.target.id}'::uuid
        )
        or (select count(*) from private.account_closure_memberships
             where closure_request_id = '${targetClosureId}'::uuid) <>
               ${closureAcceptanceWon ? 2 : 1}
        or (select count(*) from private.audit_events
             where event_type = 'invitation_job_invalidated'
               and subject_id = '${closureAcceptance.jobId}'::uuid) <> 1
        or (select count(*) from private.audit_events
             where event_type = 'invitation_job_invalidated'
               and subject_id = '${closureAcceptance.jobId}'::uuid
               and (
                 ${closureAcceptanceWon ? `actor_membership_id = '${racedClosureAcceptance.body}'::uuid` : "actor_membership_id is null"}
               )) <> 1
        or not exists (
          select 1 from private.invitation_jobs
           where id = '${closureAcceptance.jobId}'::uuid
             and state = 'invalidated'
             and invalidation_reason =
               '${closureAcceptanceWon ? "target_accepted" : "account_closure"}'
             and (
               ${closureAcceptanceWon ? `invalidated_by_membership_id = '${racedClosureAcceptance.body}'::uuid` : "invalidated_by_membership_id is null"}
             )
             and (
               ${closureAcceptanceWon ? "invalidated_by_closure_request_id is null" : `invalidated_by_closure_request_id = '${targetClosureId}'::uuid`}
             )
        )
        or not exists (
          select 1 from private.invitations
           where id = '${closureMaterialization.invitation_id}'::uuid
             and invitation_job_id = '${closureAcceptance.jobId}'::uuid
             and (
               (
                 ${closureAcceptanceWon ? "true" : "false"}
                 and accepted_membership_id =
                   '${closureAcceptanceWon ? racedClosureAcceptance.body : ORGANIZER_A_MEMBERSHIP}'::uuid
                 and accepted_at is not null
                 and revoked_at is null
                 and revoked_by_membership_id is null
                 and revoked_by_closure_request_id is null
               )
               or (
                 ${closureAcceptanceWon ? "false" : "true"}
                 and accepted_at is null
                 and revoked_at is not null
                 and revocation_reason = 'account_closure'
                 and revoked_by_membership_id is null
                 and revoked_by_closure_request_id =
                   '${targetClosureId}'::uuid
               )
             )
        )
        or (select count(*) from private.audit_events
             where event_type = 'invitation_accepted'
               and subject_id =
                 '${closureMaterialization.invitation_id}'::uuid) <>
                   ${closureAcceptanceWon ? 1 : 0}
        or (select count(*) from private.audit_events
             where event_type = 'invitation_accepted'
               and subject_id =
                 '${closureMaterialization.invitation_id}'::uuid
               and actor_membership_id =
                 '${closureAcceptanceWon ? racedClosureAcceptance.body : ORGANIZER_A_MEMBERSHIP}'::uuid) <>
                   ${closureAcceptanceWon ? 1 : 0}
        or (select count(*) from private.audit_events
             where event_type = 'invitation_revoked'
               and subject_id =
                 '${closureMaterialization.invitation_id}'::uuid) <> 0 then
        raise exception 'Prepared acceptance/closure race retained access or duplicate terminal history';
      end if;
    end
    $phase2c_accept_closure_prepared_audit$;
  `);
  process.stdout.write("Phase 2C accept/target-closure race passed.\n");

  const organizerClosureSuffix = randomUUID();
  const organizerClosureCircleId = randomUUID();
  const organizerClosurePeople = [randomUUID(), randomUUID()];
  const organizerClosureMemberships = [randomUUID(), randomUUID()];
  const organizerClosureUsers = await Promise.all(
    ["one", "two"].map((label) =>
      jsonRequest(apiUrl, serviceKey, serviceKey, "/auth/v1/admin/users", {
        body: JSON.stringify({
          email: `closure-organizer-${label}-${organizerClosureSuffix}@example.test`,
          email_confirm: true,
        }),
        method: "POST",
      }),
    ),
  );
  if (
    organizerClosureUsers.some(
      ({ response, body }) => !response.ok || !uuid.test(body?.id),
    )
  ) {
    throw new Error("Two-organizer closure Auth setup failed.");
  }

  runDatabaseQuery(`
    do $two_organizer_setup$
    begin

    insert into public.circles (
      id,
      name,
      time_zone,
      created_by_membership_id
    ) values (
      '${organizerClosureCircleId}'::uuid,
      'Closure concurrency circle',
      'UTC',
      '${organizerClosureMemberships[0]}'::uuid
    );

    insert into public.people (
      id,
      circle_id,
      display_name,
      profile_kind,
      accent_token,
      created_by_membership_id
    ) values
      (
        '${organizerClosurePeople[0]}'::uuid,
        '${organizerClosureCircleId}'::uuid,
        'Closure organizer one',
        'account',
        'clay',
        '${organizerClosureMemberships[0]}'::uuid
      ),
      (
        '${organizerClosurePeople[1]}'::uuid,
        '${organizerClosureCircleId}'::uuid,
        'Closure organizer two',
        'account',
        'sage',
        '${organizerClosureMemberships[0]}'::uuid
      );

    insert into public.circle_memberships (
      id,
      circle_id,
      user_id,
      person_id,
      role,
      status
    ) values
      (
        '${organizerClosureMemberships[0]}'::uuid,
        '${organizerClosureCircleId}'::uuid,
        '${organizerClosureUsers[0].body.id}'::uuid,
        '${organizerClosurePeople[0]}'::uuid,
        'organizer',
        'active'
      ),
      (
        '${organizerClosureMemberships[1]}'::uuid,
        '${organizerClosureCircleId}'::uuid,
        '${organizerClosureUsers[1].body.id}'::uuid,
        '${organizerClosurePeople[1]}'::uuid,
        'organizer',
        'active'
      );

    end
    $two_organizer_setup$;
  `);

  const organizerClosureTokens = organizerClosureUsers.map(({ body }) =>
    createLocalUserToken(body.id, jwtSecret),
  );
  const organizerClosureKeys = [randomUUID(), randomUUID()];
  const organizerClosureRace = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: organizerClosureCircleId,
    holderToken: organizerClosureTokens[0],
    operationName: "two-organizer closure requests",
    operationNames: ["request_account_closure"],
    requests: organizerClosureTokens.map(
      (token, index) => () =>
        jsonRequest(apiUrl, apiKey, token, "rpc/request_account_closure", {
          body: JSON.stringify({ request_key: organizerClosureKeys[index] }),
          method: "POST",
        }),
    ),
    serviceKey,
  });
  const organizerClosureSuccessIndexes = organizerClosureRace
    .map(({ response }, index) => (response.ok ? index : -1))
    .filter((index) => index >= 0);
  if (organizerClosureSuccessIndexes.length !== 1) {
    throw new Error(
      `Two-organizer closure race did not select exactly one request (${organizerClosureRace
        .map(
          ({ response, body }) => `${response.status}:${JSON.stringify(body)}`,
        )
        .join(", ")}).`,
    );
  }
  const closingOrganizerIndex = organizerClosureSuccessIndexes[0];
  const survivingOrganizerIndex = closingOrganizerIndex === 0 ? 1 : 0;
  const organizerClosureId = organizerClosureRace[closingOrganizerIndex].body;
  const organizerClosureDenial =
    organizerClosureRace[survivingOrganizerIndex].body;
  if (
    !uuid.test(organizerClosureId) ||
    organizerClosureDenial?.code === "40P01" ||
    organizerClosureDenial?.code !== "23514" ||
    organizerClosureDenial?.message !==
      "Every family must retain an active organizer"
  ) {
    throw new Error(
      `The losing organizer closure request did not use the last-viable-organizer constraint (${organizerClosureDenial?.code ?? "none"}).`,
    );
  }

  const sameKeyClosureRace = await runOverlappedAuthRace({
    apiKey,
    apiUrl,
    operationName: "same-user same-key closure replays",
    operationNames: ["request_account_closure"],
    requests: [0, 1].map(
      () => () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerClosureTokens[closingOrganizerIndex],
          "rpc/request_account_closure",
          {
            body: JSON.stringify({
              request_key: organizerClosureKeys[closingOrganizerIndex],
            }),
            method: "POST",
          },
        ),
    ),
    serviceKey,
    targetAuthUserId: organizerClosureUsers[closingOrganizerIndex].body.id,
  });
  if (
    sameKeyClosureRace.some(
      ({ response, body }) => !response.ok || body !== organizerClosureId,
    )
  ) {
    throw new Error(
      "Same-user same-key closure replays did not return one ID.",
    );
  }

  const conflictingClosureRequest = await jsonRequest(
    apiUrl,
    apiKey,
    organizerClosureTokens[closingOrganizerIndex],
    "rpc/request_account_closure",
    {
      body: JSON.stringify({ request_key: randomUUID() }),
      method: "POST",
    },
  );
  if (
    conflictingClosureRequest.response.ok ||
    conflictingClosureRequest.body?.code !== "22023" ||
    conflictingClosureRequest.body?.message !==
      "Account closure could not be requested"
  ) {
    throw new Error("A conflicting closure request key did not fail closed.");
  }

  const survivingOrganizerExportKey = randomUUID();
  const survivingOrganizerExport = await jsonRequest(
    apiUrl,
    apiKey,
    organizerClosureTokens[survivingOrganizerIndex],
    "rpc/request_family_export",
    {
      body: JSON.stringify({
        circle_id: organizerClosureCircleId,
        request_key: survivingOrganizerExportKey,
      }),
      method: "POST",
    },
  );
  if (
    !survivingOrganizerExport.response.ok ||
    !uuid.test(survivingOrganizerExport.body)
  ) {
    throw new Error(
      "The surviving organizer could not use organizer authority.",
    );
  }

  runDatabaseQuery(`
    do $two_organizer_closure_audit$
    declare
      closure_count integer;
      immutable_denial_observed boolean := false;
      viable_organizer_count integer;
    begin
      select count(*)::integer into closure_count
        from private.account_closure_requests
       where auth_user_id in (
         '${organizerClosureUsers[0].body.id}'::uuid,
         '${organizerClosureUsers[1].body.id}'::uuid
       );

      begin
        update private.account_closure_requests
           set request_key = '${randomUUID()}'::uuid
         where id = '${organizerClosureId}'::uuid;
      exception
        when sqlstate '42501' then
          immutable_denial_observed := true;
      end;

      select count(*)::integer into viable_organizer_count
        from public.circle_memberships as membership
       where membership.circle_id = '${organizerClosureCircleId}'::uuid
         and membership.status = 'active'
         and membership.role = 'organizer'
         and membership.user_id is not null
         and not private.account_closure_is_blocking(membership.user_id);

      if closure_count <> 1
        or not immutable_denial_observed
        or viable_organizer_count <> 1
        or not exists (
          select 1
            from private.account_closure_requests
           where id = '${organizerClosureId}'::uuid
             and auth_user_id =
               '${organizerClosureUsers[closingOrganizerIndex].body.id}'::uuid
             and request_key =
               '${organizerClosureKeys[closingOrganizerIndex]}'::uuid
             and state = 'requested'
        )
        or not exists (
          select 1
            from public.circle_memberships
           where id =
               '${organizerClosureMemberships[survivingOrganizerIndex]}'::uuid
             and circle_id = '${organizerClosureCircleId}'::uuid
             and user_id =
               '${organizerClosureUsers[survivingOrganizerIndex].body.id}'::uuid
             and status = 'active'
             and role = 'organizer'
        )
        or not exists (
          select 1
            from private.export_jobs
           where id = '${survivingOrganizerExport.body}'::uuid
             and circle_id = '${organizerClosureCircleId}'::uuid
             and requested_by_membership_id =
               '${organizerClosureMemberships[survivingOrganizerIndex]}'::uuid
             and request_key = '${survivingOrganizerExportKey}'::uuid
             and state = 'queued'
             and private.export_job_requester_is_authorized(id)
        ) then
        raise exception 'Two-organizer closure race left duplicate, mutable, dead, or unusable organizer state';
      end if;
    end
    $two_organizer_closure_audit$;
  `);

  runDatabaseQuery(`
    update public.circle_memberships
       set status = 'active',
           role = 'organizer',
           revoked_at = null,
           revoked_by_membership_id = null
     where id in (
       '${ORGANIZER_A_MEMBERSHIP}'::uuid,
       '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid,
       '${ORGANIZER_B_MEMBERSHIP}'::uuid,
       '${DUAL_ORGANIZER_B_MEMBERSHIP}'::uuid
     );
  `);

  const closureReplayKey = randomUUID();
  const closureReplaySetup = await jsonRequest(
    apiUrl,
    apiKey,
    organizerATwoToken,
    "rpc/request_account_closure",
    {
      body: JSON.stringify({ request_key: closureReplayKey }),
      method: "POST",
    },
  );
  if (!closureReplaySetup.response.ok || !uuid.test(closureReplaySetup.body)) {
    throw new Error(
      `Closure request/prepare setup failed with ${closureReplaySetup.response.status}.`,
    );
  }

  const closureReplayResults = await runOverlappedAuthRace({
    apiKey,
    apiUrl,
    operationName: "closure request replay and prepare",
    operationNames: [
      "request_account_closure",
      "phase7c_test_prepare_account_closure",
    ],
    requests: [
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerATwoToken,
          "rpc/request_account_closure",
          {
            body: JSON.stringify({ request_key: closureReplayKey }),
            method: "POST",
          },
        ),
      () =>
        jsonRequest(
          apiUrl,
          serviceKey,
          serviceKey,
          "rpc/phase7c_test_prepare_account_closure",
          {
            body: JSON.stringify({
              closure_request_id: closureReplaySetup.body,
            }),
            method: "POST",
          },
        ),
    ],
    serviceKey,
    targetAuthUserId: ORGANIZER_A_TWO,
  });
  if (
    closureReplayResults.some(
      ({ response, body }) => !response.ok || body !== closureReplaySetup.body,
    )
  ) {
    throw new Error(
      `Closure request/prepare replay did not converge (${closureReplayResults
        .map(
          ({ response, body }) => `${response.status}:${JSON.stringify(body)}`,
        )
        .join(", ")}).`,
    );
  }

  const preparedClosureReplays = await Promise.all(
    [0, 1].map(() =>
      jsonRequest(
        apiUrl,
        serviceKey,
        serviceKey,
        "rpc/phase7c_test_prepare_account_closure",
        {
          body: JSON.stringify({
            closure_request_id: closureReplaySetup.body,
          }),
          method: "POST",
        },
      ),
    ),
  );
  if (
    preparedClosureReplays.some(
      ({ response, body }) => !response.ok || body !== closureReplaySetup.body,
    )
  ) {
    throw new Error("Prepared closure replay did not remain idempotent.");
  }

  runDatabaseQuery(`
    do $closure_replay_audit$
    declare
      closure_count integer;
      closure_membership_count integer;
      prepared_audit_count integer;
      organizer_count integer;
    begin
      select count(*)::integer into closure_count
        from private.account_closure_requests
       where auth_user_id = '${ORGANIZER_A_TWO}'::uuid
         and id = '${closureReplaySetup.body}'::uuid
         and request_key = '${closureReplayKey}'::uuid
         and state = 'prepared';
      select count(*)::integer into closure_membership_count
        from private.account_closure_memberships
       where closure_request_id = '${closureReplaySetup.body}'::uuid
         and circle_id = '${CIRCLE_A}'::uuid
         and membership_id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid;
      select count(*)::integer into prepared_audit_count
        from private.audit_events
       where circle_id = '${CIRCLE_A}'::uuid
         and actor_membership_id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid
         and event_type = 'account_closure_prepared'
         and subject_id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid;
      select count(*)::integer into organizer_count
        from public.circle_memberships
       where circle_id = '${CIRCLE_A}'::uuid
         and status = 'active'
         and role = 'organizer';

      if closure_count <> 1
        or closure_membership_count <> 1
        or prepared_audit_count <> 1
        or organizer_count <> 1
        or not exists (
          select 1
            from public.circle_memberships
           where id = '${ORGANIZER_A_TWO_MEMBERSHIP}'::uuid
             and status = 'revoked'
             and user_id is null
             and revoked_by_membership_id = id
        ) then
        raise exception 'Closure request/prepare replay left duplicate, partial, or falsely attributed state';
      end if;
    end
    $closure_replay_audit$;
  `);

  const topologyClosureKey = randomUUID();
  const topologyClosureSetup = await jsonRequest(
    apiUrl,
    apiKey,
    dualOrganizerToken,
    "rpc/request_account_closure",
    {
      body: JSON.stringify({ request_key: topologyClosureKey }),
      method: "POST",
    },
  );
  if (
    !topologyClosureSetup.response.ok ||
    !uuid.test(topologyClosureSetup.body)
  ) {
    throw new Error(
      `Last-organizer/closure setup failed with ${topologyClosureSetup.response.status}.`,
    );
  }

  const topologyResults = await runOverlappedCircleRace({
    apiKey,
    apiUrl,
    circleId: CIRCLE_B,
    holderToken: organizerToken,
    operationName: "last-organizer topology change and closure prepare",
    operationNames: [
      "set_membership_role",
      "phase7c_test_prepare_account_closure",
    ],
    requests: [
      () =>
        jsonRequest(
          apiUrl,
          serviceKey,
          serviceKey,
          "rpc/phase7c_test_prepare_account_closure",
          {
            body: JSON.stringify({
              closure_request_id: topologyClosureSetup.body,
            }),
            method: "POST",
          },
        ),
      () =>
        jsonRequest(apiUrl, apiKey, organizerToken, "rpc/set_membership_role", {
          body: JSON.stringify({
            membership_id: ORGANIZER_B_MEMBERSHIP,
            role: "member",
          }),
          method: "POST",
        }),
    ],
    serviceKey,
  });
  const [topologyPrepare, topologyDemotion] = topologyResults;
  if (topologyPrepare.response.ok === topologyDemotion.response.ok) {
    throw new Error(
      `Last-organizer/closure race did not select exactly one valid serial outcome (${topologyResults
        .map(
          ({ response, body }) => `${response.status}:${JSON.stringify(body)}`,
        )
        .join(", ")}).`,
    );
  }
  const topologyDenial = topologyPrepare.response.ok
    ? topologyDemotion
    : topologyPrepare;
  if (
    topologyDenial.body?.code === "40P01" ||
    !new Set(["22023", "23514"]).has(topologyDenial.body?.code)
  ) {
    throw new Error(
      `Last-organizer/closure race did not use a constraint denial (${topologyDenial.body?.code ?? "none"}).`,
    );
  }

  const topologyPreparedFirst = topologyPrepare.response.ok;
  runDatabaseQuery(`
    do $topology_intermediate_audit$
    declare
      detached_count integer;
      mapped_count integer;
      prepared_audit_count integer;
      closure_state text;
      surviving_organizer_count integer;
    begin
      select count(*)::integer into detached_count
        from public.circle_memberships
       where user_id is null
         and id in (
           '${DUAL_ORGANIZER_A_MEMBERSHIP}'::uuid,
           '${DUAL_ORGANIZER_B_MEMBERSHIP}'::uuid
         );
      select count(*)::integer into mapped_count
        from private.account_closure_memberships
       where closure_request_id = '${topologyClosureSetup.body}'::uuid;
      select count(*)::integer into prepared_audit_count
        from private.audit_events
       where event_type = 'account_closure_prepared'
         and subject_id in (
           '${DUAL_ORGANIZER_A_MEMBERSHIP}'::uuid,
           '${DUAL_ORGANIZER_B_MEMBERSHIP}'::uuid
         );
      select state into closure_state
        from private.account_closure_requests
       where id = '${topologyClosureSetup.body}'::uuid;
      select count(*)::integer into surviving_organizer_count
        from public.circle_memberships
       where circle_id = '${CIRCLE_B}'::uuid
         and status = 'active'
         and role = 'organizer';

      if ${topologyPreparedFirst ? "true" : "false"} then
        if detached_count <> 2
          or mapped_count <> 2
          or prepared_audit_count <> 2
          or closure_state <> 'prepared'
          or surviving_organizer_count <> 1 then
          raise exception 'Successful topology/prepare race did not detach every circle atomically';
        end if;
      elsif detached_count <> 0
        or mapped_count <> 0
        or prepared_audit_count <> 0
        or closure_state <> 'requested'
        or surviving_organizer_count <> 1 then
        raise exception 'Denied topology/prepare race left partial cross-circle closure state';
      end if;
    end
    $topology_intermediate_audit$;
  `);

  if (!topologyPreparedFirst) {
    runDatabaseQuery(`
      update public.circle_memberships
         set role = 'organizer'
       where id = '${ORGANIZER_B_MEMBERSHIP}'::uuid;
    `);
  }

  const topologyFinalPrepare = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "rpc/phase7c_test_prepare_account_closure",
    {
      body: JSON.stringify({
        closure_request_id: topologyClosureSetup.body,
      }),
      method: "POST",
    },
  );
  if (
    !topologyFinalPrepare.response.ok ||
    topologyFinalPrepare.body !== topologyClosureSetup.body
  ) {
    throw new Error("A valid topology could not finish closure preparation.");
  }

  const topologyPrepareReplays = await Promise.all(
    [0, 1].map(() =>
      jsonRequest(
        apiUrl,
        serviceKey,
        serviceKey,
        "rpc/phase7c_test_prepare_account_closure",
        {
          body: JSON.stringify({
            closure_request_id: topologyClosureSetup.body,
          }),
          method: "POST",
        },
      ),
    ),
  );
  if (
    topologyPrepareReplays.some(
      ({ response, body }) =>
        !response.ok || body !== topologyClosureSetup.body,
    )
  ) {
    throw new Error("Concurrent prepared-closure replays did not converge.");
  }

  runDatabaseQuery(`
    do $topology_final_audit$
    declare
      detached_count integer;
      mapped_count integer;
      prepared_audit_count integer;
      organizer_count integer;
    begin
      select count(*)::integer into detached_count
        from public.circle_memberships
       where id in (
           '${DUAL_ORGANIZER_A_MEMBERSHIP}'::uuid,
           '${DUAL_ORGANIZER_B_MEMBERSHIP}'::uuid
         )
         and status = 'revoked'
         and user_id is null
         and revoked_by_membership_id = id;
      select count(*)::integer into mapped_count
        from private.account_closure_memberships
       where closure_request_id = '${topologyClosureSetup.body}'::uuid;
      select count(*)::integer into prepared_audit_count
        from private.audit_events
       where event_type = 'account_closure_prepared'
         and actor_membership_id = subject_id
         and subject_id in (
           '${DUAL_ORGANIZER_A_MEMBERSHIP}'::uuid,
           '${DUAL_ORGANIZER_B_MEMBERSHIP}'::uuid
         );
      select count(*)::integer into organizer_count
        from public.circle_memberships
       where circle_id = '${CIRCLE_B}'::uuid
         and status = 'active'
         and role = 'organizer';

      if detached_count <> 2
        or mapped_count <> 2
        or prepared_audit_count <> 2
        or organizer_count <> 1
        or not exists (
          select 1
            from private.account_closure_requests
           where id = '${topologyClosureSetup.body}'::uuid
             and state = 'prepared'
        ) then
        raise exception 'Closure replay resurrected access or duplicated cross-circle terminal history';
      end if;
    end
    $topology_final_audit$;
  `);

  const invitationClosureSuffix = randomUUID();
  const invitationClosureEmail = `closure-invitation-${invitationClosureSuffix}@example.test`;
  const invitationClosureUser = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "/auth/v1/admin/users",
    {
      body: JSON.stringify({
        email: invitationClosureEmail,
        email_confirm: true,
      }),
      method: "POST",
    },
  );
  const invitationWorkTarget = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "/auth/v1/admin/users",
    {
      body: JSON.stringify({
        email: `closure-work-target-${invitationClosureSuffix}@example.test`,
        email_confirm: true,
      }),
      method: "POST",
    },
  );
  if (
    !invitationClosureUser.response.ok ||
    !uuid.test(invitationClosureUser.body?.id) ||
    !invitationWorkTarget.response.ok ||
    !uuid.test(invitationWorkTarget.body?.id)
  ) {
    throw new Error("Invitation/closure Auth setup failed.");
  }

  const invitationClosurePersonId = randomUUID();
  const invitationClosureMembershipId = randomUUID();
  runDatabaseQuery(`
    do $invitation_closure_setup$
    begin
    insert into public.people (
      id,
      circle_id,
      display_name,
      profile_kind,
      accent_token,
      created_by_membership_id
    ) values (
      '${invitationClosurePersonId}'::uuid,
      '${CIRCLE_B}'::uuid,
      'Closure invitation organizer',
      'account',
      'sky',
      '${ORGANIZER_B_MEMBERSHIP}'::uuid
    );

    insert into public.circle_memberships (
      id,
      circle_id,
      user_id,
      person_id,
      role,
      status
    ) values (
      '${invitationClosureMembershipId}'::uuid,
      '${CIRCLE_B}'::uuid,
      '${invitationClosureUser.body.id}'::uuid,
      '${invitationClosurePersonId}'::uuid,
      'organizer',
      'active'
    );
    end
    $invitation_closure_setup$;
  `);

  const invitationClosureToken = createLocalUserToken(
    invitationClosureUser.body.id,
    jwtSecret,
  );
  const targetJobRequestKey = randomUUID();
  const targetJob = await jsonRequest(
    apiUrl,
    apiKey,
    organizerAToken,
    "rpc/request_invitation_job",
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        target_auth_user_id: invitationClosureUser.body.id,
        display_name: `Closure target ${invitationClosureSuffix}`,
        request_key: targetJobRequestKey,
      }),
      method: "POST",
    },
  );
  const requesterJobRequestKey = randomUUID();
  const requesterJob = await jsonRequest(
    apiUrl,
    apiKey,
    invitationClosureToken,
    "rpc/request_invitation_job",
    {
      body: JSON.stringify({
        circle_id: CIRCLE_B,
        target_auth_user_id: invitationWorkTarget.body.id,
        display_name: `Closure requester ${invitationClosureSuffix}`,
        request_key: requesterJobRequestKey,
      }),
      method: "POST",
    },
  );
  const legacyClosureInvitation = await jsonRequest(
    apiUrl,
    apiKey,
    organizerAToken,
    "rpc/create_invitation",
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        display_name: `Closure legacy ${invitationClosureSuffix}`,
        email: invitationClosureEmail,
      }),
      method: "POST",
    },
  );
  const legacyClosureInvitationResult = legacyClosureInvitation.body?.[0];
  if (
    !targetJob.response.ok ||
    !uuid.test(targetJob.body) ||
    !requesterJob.response.ok ||
    !uuid.test(requesterJob.body) ||
    !legacyClosureInvitation.response.ok ||
    !uuid.test(legacyClosureInvitationResult?.invitation_id)
  ) {
    throw new Error("Invitation/closure durable-work setup failed.");
  }

  const invitationClosureKey = randomUUID();
  const invitationClosureRace = await runOverlappedAuthRace({
    apiKey,
    apiUrl,
    operationName: "invitation target/request work and closure request",
    operationNames: ["request_invitation_job", "request_account_closure"],
    requests: [
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          organizerAToken,
          "rpc/request_invitation_job",
          {
            body: JSON.stringify({
              circle_id: CIRCLE_A,
              target_auth_user_id: invitationClosureUser.body.id,
              display_name: `Closure target ${invitationClosureSuffix}`,
              request_key: targetJobRequestKey,
            }),
            method: "POST",
          },
        ),
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          invitationClosureToken,
          "rpc/request_invitation_job",
          {
            body: JSON.stringify({
              circle_id: CIRCLE_B,
              target_auth_user_id: invitationWorkTarget.body.id,
              display_name: `Closure requester ${invitationClosureSuffix}`,
              request_key: requesterJobRequestKey,
            }),
            method: "POST",
          },
        ),
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          invitationClosureToken,
          "rpc/request_account_closure",
          {
            body: JSON.stringify({ request_key: invitationClosureKey }),
            method: "POST",
          },
        ),
    ],
    serviceKey,
    targetAuthUserId: invitationClosureUser.body.id,
  });
  const [targetJobReplay, requesterJobReplay, invitationClosureRequest] =
    invitationClosureRace;
  if (
    !invitationClosureRequest.response.ok ||
    !uuid.test(invitationClosureRequest.body)
  ) {
    throw new Error(
      `Invitation/closure request did not survive its valid serial outcomes (${invitationClosureRequest.response.status}).`,
    );
  }
  for (const [jobReplay, expectedJobId] of [
    [targetJobReplay, targetJob.body],
    [requesterJobReplay, requesterJob.body],
  ]) {
    if (jobReplay.response.ok) {
      if (jobReplay.body !== expectedJobId) {
        throw new Error("Invitation replay changed durable job identity.");
      }
    } else if (
      jobReplay.body?.code === "40P01" ||
      jobReplay.body?.code !== "42501" ||
      jobReplay.body?.message !== "Invitation delivery could not be requested"
    ) {
      throw new Error(
        `Invitation/closure replay did not use the generic blocking path (${jobReplay.body?.code ?? "none"}).`,
      );
    }
  }

  const invitationClosurePrepare = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "rpc/phase7c_test_prepare_account_closure",
    {
      body: JSON.stringify({
        closure_request_id: invitationClosureRequest.body,
      }),
      method: "POST",
    },
  );
  if (
    !invitationClosurePrepare.response.ok ||
    invitationClosurePrepare.body !== invitationClosureRequest.body
  ) {
    throw new Error(
      "Invitation/closure work could not be terminally prepared.",
    );
  }

  const blockedInvitationReplays = await Promise.all([
    jsonRequest(apiUrl, apiKey, organizerAToken, "rpc/request_invitation_job", {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        target_auth_user_id: invitationClosureUser.body.id,
        display_name: `Closure target ${invitationClosureSuffix}`,
        request_key: targetJobRequestKey,
      }),
      method: "POST",
    }),
    jsonRequest(
      apiUrl,
      apiKey,
      invitationClosureToken,
      "rpc/request_invitation_job",
      {
        body: JSON.stringify({
          circle_id: CIRCLE_B,
          target_auth_user_id: invitationWorkTarget.body.id,
          display_name: `Closure requester ${invitationClosureSuffix}`,
          request_key: requesterJobRequestKey,
        }),
        method: "POST",
      },
    ),
  ]);
  if (
    blockedInvitationReplays.some(
      ({ response, body }) =>
        response.ok ||
        body?.code !== "42501" ||
        body?.message !== "Invitation delivery could not be requested",
    )
  ) {
    throw new Error("Prepared closure allowed invitation work to resurrect.");
  }

  runDatabaseQuery(`
    do $invitation_closure_audit$
    declare
      closure_membership_count integer;
      closure_audit_count integer;
    begin
      select count(*)::integer into closure_membership_count
        from private.account_closure_memberships
       where closure_request_id = '${invitationClosureRequest.body}'::uuid
         and circle_id = '${CIRCLE_B}'::uuid
         and membership_id = '${invitationClosureMembershipId}'::uuid;
      select count(*)::integer into closure_audit_count
        from private.audit_events
       where circle_id = '${CIRCLE_B}'::uuid
         and actor_membership_id = '${invitationClosureMembershipId}'::uuid
         and event_type = 'account_closure_prepared'
         and subject_id = '${invitationClosureMembershipId}'::uuid;

      if closure_membership_count <> 1
        or closure_audit_count <> 1
        or not exists (
          select 1
            from public.circle_memberships
           where id = '${invitationClosureMembershipId}'::uuid
             and status = 'revoked'
             and user_id is null
             and revoked_by_membership_id = id
        )
        or not exists (
          select 1
            from private.invitation_jobs
           where id = '${targetJob.body}'::uuid
             and state = 'invalidated'
             and invalidated_by_membership_id is null
             and invalidated_by_closure_request_id =
               '${invitationClosureRequest.body}'::uuid
             and invalidation_reason = 'account_closure'
             and not private.invitation_job_requester_is_authorized(id)
        )
        or not exists (
          select 1
            from private.invitation_jobs
           where id = '${requesterJob.body}'::uuid
             and state = 'invalidated'
             and invalidated_by_membership_id is null
             and invalidated_by_closure_request_id =
               '${invitationClosureRequest.body}'::uuid
             and invalidation_reason = 'account_closure'
             and not private.invitation_job_requester_is_authorized(id)
        )
        or not exists (
          select 1
            from private.invitations
           where id = '${legacyClosureInvitationResult.invitation_id}'::uuid
             and accepted_at is null
             and revoked_at is not null
             and revoked_by_membership_id is null
             and revoked_by_closure_request_id =
               '${invitationClosureRequest.body}'::uuid
             and revocation_reason = 'account_closure'
        ) then
        raise exception 'Invitation/closure race left resurrectable or falsely attributed terminal work';
      end if;
    end
    $invitation_closure_audit$;
  `);

  const acceptanceClosureSuffix = randomUUID();
  const acceptanceClosureEmail = `acceptance-closure-${acceptanceClosureSuffix}@example.test`;
  const acceptanceClosureUser = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "/auth/v1/admin/users",
    {
      body: JSON.stringify({
        email: acceptanceClosureEmail,
        email_confirm: true,
      }),
      method: "POST",
    },
  );
  if (
    !acceptanceClosureUser.response.ok ||
    !uuid.test(acceptanceClosureUser.body?.id)
  ) {
    throw new Error("Invitation acceptance/closure Auth setup failed.");
  }

  const acceptanceClosurePersonId = randomUUID();
  const acceptanceClosureMembershipId = randomUUID();
  runDatabaseQuery(`
    do $acceptance_closure_setup$
    begin
    insert into public.people (
      id,
      circle_id,
      display_name,
      profile_kind,
      accent_token,
      created_by_membership_id
    ) values (
      '${acceptanceClosurePersonId}'::uuid,
      '${CIRCLE_B}'::uuid,
      'Acceptance closure member',
      'account',
      'gold',
      '${ORGANIZER_B_MEMBERSHIP}'::uuid
    );

    insert into public.circle_memberships (
      id,
      circle_id,
      user_id,
      person_id,
      role,
      status
    ) values (
      '${acceptanceClosureMembershipId}'::uuid,
      '${CIRCLE_B}'::uuid,
      '${acceptanceClosureUser.body.id}'::uuid,
      '${acceptanceClosurePersonId}'::uuid,
      'member',
      'active'
    );
    end
    $acceptance_closure_setup$;
  `);

  const acceptanceClosureInvitation = await jsonRequest(
    apiUrl,
    apiKey,
    organizerAToken,
    "rpc/create_invitation",
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        display_name: `Acceptance closure ${acceptanceClosureSuffix}`,
        email: acceptanceClosureEmail,
      }),
      method: "POST",
    },
  );
  const acceptanceClosureInvitationResult =
    acceptanceClosureInvitation.body?.[0];
  if (
    !acceptanceClosureInvitation.response.ok ||
    !uuid.test(acceptanceClosureInvitationResult?.invitation_id) ||
    typeof acceptanceClosureInvitationResult?.raw_token !== "string"
  ) {
    throw new Error("Invitation acceptance/closure invitation setup failed.");
  }

  const acceptanceClosureToken = createLocalUserToken(
    acceptanceClosureUser.body.id,
    jwtSecret,
  );
  const acceptanceClosureKey = randomUUID();
  const acceptanceClosureRace = await runOverlappedAuthRace({
    apiKey,
    apiUrl,
    operationName: "invitation acceptance and account closure request",
    operationNames: ["accept_invitation", "request_account_closure"],
    requests: [
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          acceptanceClosureToken,
          "rpc/accept_invitation",
          {
            body: JSON.stringify({
              token: acceptanceClosureInvitationResult.raw_token,
            }),
            method: "POST",
          },
        ),
      () =>
        jsonRequest(
          apiUrl,
          apiKey,
          acceptanceClosureToken,
          "rpc/request_account_closure",
          {
            body: JSON.stringify({ request_key: acceptanceClosureKey }),
            method: "POST",
          },
        ),
    ],
    serviceKey,
    targetAuthUserId: acceptanceClosureUser.body.id,
  });
  const [racedInvitationAcceptance, racedAcceptanceClosureRequest] =
    acceptanceClosureRace;
  if (
    !racedAcceptanceClosureRequest.response.ok ||
    !uuid.test(racedAcceptanceClosureRequest.body) ||
    racedAcceptanceClosureRequest.body?.code === "40P01"
  ) {
    throw new Error(
      `Invitation acceptance/closure request did not preserve closure intent (${racedAcceptanceClosureRequest.response.status}).`,
    );
  }

  const invitationAcceptanceWon = racedInvitationAcceptance.response.ok;
  if (invitationAcceptanceWon) {
    if (!uuid.test(racedInvitationAcceptance.body)) {
      throw new Error(
        "Invitation acceptance/closure race returned an invalid membership.",
      );
    }
  } else if (
    racedInvitationAcceptance.body?.code === "40P01" ||
    racedInvitationAcceptance.body?.code !== "22023" ||
    racedInvitationAcceptance.body?.message !== "Invitation is not available"
  ) {
    throw new Error(
      `Invitation acceptance/closure race did not use a valid serial denial (${racedInvitationAcceptance.body?.code ?? "none"}).`,
    );
  }

  const acceptanceClosurePrepare = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "rpc/phase7c_test_prepare_account_closure",
    {
      body: JSON.stringify({
        closure_request_id: racedAcceptanceClosureRequest.body,
      }),
      method: "POST",
    },
  );
  if (
    !acceptanceClosurePrepare.response.ok ||
    acceptanceClosurePrepare.body !== racedAcceptanceClosureRequest.body ||
    acceptanceClosurePrepare.body?.code === "40P01"
  ) {
    throw new Error("Invitation acceptance/closure preparation failed.");
  }

  const acceptanceClosurePrepareReplay = await jsonRequest(
    apiUrl,
    serviceKey,
    serviceKey,
    "rpc/phase7c_test_prepare_account_closure",
    {
      body: JSON.stringify({
        closure_request_id: racedAcceptanceClosureRequest.body,
      }),
      method: "POST",
    },
  );
  if (
    !acceptanceClosurePrepareReplay.response.ok ||
    acceptanceClosurePrepareReplay.body !== racedAcceptanceClosureRequest.body
  ) {
    throw new Error("Invitation acceptance/closure prepare replay diverged.");
  }

  const acceptanceAfterClosure = await jsonRequest(
    apiUrl,
    apiKey,
    acceptanceClosureToken,
    "rpc/accept_invitation",
    {
      body: JSON.stringify({
        token: acceptanceClosureInvitationResult.raw_token,
      }),
      method: "POST",
    },
  );
  if (
    acceptanceAfterClosure.response.ok ||
    acceptanceAfterClosure.body?.code === "40P01" ||
    acceptanceAfterClosure.body?.code !== "22023" ||
    acceptanceAfterClosure.body?.message !== "Invitation is not available"
  ) {
    throw new Error(
      "Prepared closure allowed its raced invitation to become available.",
    );
  }

  runDatabaseQuery(`
    do $acceptance_closure_audit$
    declare
      closure_audit_count integer;
      closure_map_count integer;
      closure_map_distinct_count integer;
      expected_membership_count integer :=
        ${invitationAcceptanceWon ? 2 : 1};
    begin
      select count(*)::integer,
             count(distinct membership_id)::integer
        into closure_map_count, closure_map_distinct_count
        from private.account_closure_memberships
       where closure_request_id =
         '${racedAcceptanceClosureRequest.body}'::uuid;

      select count(*)::integer into closure_audit_count
        from private.audit_events as audit
        join private.account_closure_memberships as closure_membership
          on closure_membership.circle_id = audit.circle_id
         and closure_membership.membership_id = audit.subject_id
         and closure_membership.membership_id = audit.actor_membership_id
       where closure_membership.closure_request_id =
           '${racedAcceptanceClosureRequest.body}'::uuid
         and audit.event_type = 'account_closure_prepared';

      if closure_map_count <> expected_membership_count
        or closure_map_distinct_count <> expected_membership_count
        or closure_audit_count <> expected_membership_count
        or not exists (
          select 1
            from private.account_closure_requests
           where id = '${racedAcceptanceClosureRequest.body}'::uuid
             and auth_user_id = '${acceptanceClosureUser.body.id}'::uuid
             and request_key = '${acceptanceClosureKey}'::uuid
             and state = 'prepared'
        )
        or exists (
          select 1
            from public.circle_memberships
           where user_id = '${acceptanceClosureUser.body.id}'::uuid
        )
        or not exists (
          select 1
            from private.account_closure_memberships as closure_membership
            join public.circle_memberships as membership
              on membership.circle_id = closure_membership.circle_id
             and membership.id = closure_membership.membership_id
           where closure_membership.closure_request_id =
               '${racedAcceptanceClosureRequest.body}'::uuid
             and closure_membership.circle_id = '${CIRCLE_B}'::uuid
             and closure_membership.membership_id =
               '${acceptanceClosureMembershipId}'::uuid
             and membership.status = 'revoked'
             and membership.user_id is null
             and membership.revoked_by_membership_id = membership.id
        ) then
        raise exception 'Invitation acceptance/closure race left partial or duplicate closure state';
      end if;

      if ${invitationAcceptanceWon ? "true" : "false"} then
        if not exists (
          select 1
            from private.account_closure_memberships as closure_membership
            join public.circle_memberships as membership
              on membership.circle_id = closure_membership.circle_id
             and membership.id = closure_membership.membership_id
           where closure_membership.closure_request_id =
               '${racedAcceptanceClosureRequest.body}'::uuid
             and closure_membership.circle_id = '${CIRCLE_A}'::uuid
             and closure_membership.membership_id =
               '${invitationAcceptanceWon ? racedInvitationAcceptance.body : acceptanceClosureMembershipId}'::uuid
             and membership.status = 'revoked'
             and membership.user_id is null
             and membership.revoked_by_membership_id = membership.id
        )
        or not exists (
          select 1
            from private.invitations
           where id =
               '${acceptanceClosureInvitationResult.invitation_id}'::uuid
             and accepted_membership_id =
               '${invitationAcceptanceWon ? racedInvitationAcceptance.body : acceptanceClosureMembershipId}'::uuid
             and accepted_at is not null
             and revoked_at is null
             and revoked_by_membership_id is null
             and revoked_by_closure_request_id is null
        ) then
          raise exception 'Accepted invitation/closure race lost membership or terminal acceptance attribution';
        end if;
      elsif exists (
          select 1
            from public.circle_memberships
           where circle_id = '${CIRCLE_A}'::uuid
             and person_id = (
               select invitation.person_id
                 from private.invitations as invitation
                where invitation.id =
                  '${acceptanceClosureInvitationResult.invitation_id}'::uuid
             )
        )
        or not exists (
          select 1
            from private.invitations
           where id =
               '${acceptanceClosureInvitationResult.invitation_id}'::uuid
             and accepted_at is null
             and accepted_membership_id is null
             and revoked_at is not null
             and revoked_by_membership_id is null
             and revoked_by_closure_request_id =
               '${racedAcceptanceClosureRequest.body}'::uuid
        ) then
        raise exception 'Denied invitation/closure race created membership or lost closure revocation attribution';
      end if;
    end
    $acceptance_closure_audit$;
  `);

  process.stdout.write(
    "Overlapping organizer revocation and role changes, guardian grants, target-bound invitation materialization and acceptance against conflicts, activation, withdrawal, demotion, and closure, legacy invitation acceptance, invitation job requests, moment/tag edits, note edits, reversible responses, parent trash, member revocation, export requests, competing closure requests, closure replay, and cross-circle closure preparation serialized into valid durable state.\n",
  );
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  if (shouldRestoreFixtures) {
    try {
      resetDatabase();
    } catch (resetError) {
      if (!primaryError) throw resetError;
      process.stderr.write(
        `Fixture reset also failed after the concurrency error: ${resetError.message}\n`,
      );
    }
  }
}
