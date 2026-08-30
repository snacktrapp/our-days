import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const supabaseBinary = fileURLToPath(
  new URL("../node_modules/.bin/supabase", import.meta.url),
);

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
  operationName,
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
          operation_name: operationName,
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
    operationName: "phase2_test_hold_circle_lock",
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
      operationName,
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

function resetDatabase() {
  execFileSync(supabaseBinary, ["db", "reset", "--local"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const ORGANIZER_B = "10000000-0000-4000-8000-000000000006";
const DUAL_ORGANIZER_B = "10000000-0000-4000-8000-000000000005";
const ORGANIZER_A = "10000000-0000-4000-8000-000000000001";
const CIRCLE_A = "20000000-0000-4000-8000-000000000001";
const CIRCLE_B = "20000000-0000-4000-8000-000000000002";
const ORGANIZER_B_MEMBERSHIP = "40000000-0000-4000-8000-000000000006";
const DUAL_ORGANIZER_B_MEMBERSHIP = "40000000-0000-4000-8000-000000000007";

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
          operation_name text,
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
             and pg_catalog.strpos(
               pg_catalog.lower(activity.query),
               pg_catalog.lower(operation_name)
             ) > 0
             and case
               when require_sleep then activity.wait_event = 'PgSleep'
               else activity.wait_event_type = 'Lock'
             end;
        $body$
      $definition$;
      execute 'revoke all on function public.phase2_test_concurrency_probe(text, integer, boolean) from public, anon, authenticated';
      execute 'grant execute on function public.phase2_test_concurrency_probe(text, integer, boolean) to service_role';
    end
    $install$;
  `);

  await waitForConcurrencyProbe({
    apiKey,
    apiUrl,
    expectedWaiters: 0,
    label: "The concurrency probe schema cache",
    operationName: "phase2-schema-ready",
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

  process.stdout.write(
    "Overlapping organizer revocation, invitation acceptance, and same-revision moment edits serialized correctly with one durable winner each.\n",
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
