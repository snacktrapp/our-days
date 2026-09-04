import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

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

  if (output.trimStart().startsWith("{")) return JSON.parse(output);

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

async function jsonRequest(url, apiKey, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: apiKey,
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

async function storageRequest(apiUrl, apiKey, token, path, init = {}) {
  return fetch(`${apiUrl}/storage/v1/${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
}

async function assertStorageDenied(
  apiUrl,
  apiKey,
  token,
  actor,
  bucket,
  seededPath,
  deniedUploadPath,
) {
  const attempts = [
    {
      label: "list",
      response: await storageRequest(
        apiUrl,
        apiKey,
        token,
        `object/list/${bucket}`,
        {
          body: JSON.stringify({ limit: 100, offset: 0, prefix: "phase-2/" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ),
    },
    {
      label: "read",
      response: await storageRequest(
        apiUrl,
        apiKey,
        token,
        `object/${bucket}/${seededPath}`,
      ),
    },
    {
      label: "upload",
      response: await storageRequest(
        apiUrl,
        apiKey,
        token,
        `object/${bucket}/${deniedUploadPath}`,
        {
          body: Buffer.from("this upload must not persist", "utf8"),
          headers: {
            "content-type": "text/plain",
            "x-upsert": "false",
          },
          method: "POST",
        },
      ),
    },
  ];

  for (const { label, response } of attempts) {
    if (label === "list" && response.ok) {
      const listedObjects = await response.json();
      if (Array.isArray(listedObjects) && listedObjects.length === 0) continue;
    }

    if (response.ok) {
      throw new Error(
        `${actor} unexpectedly received ${label} access to ${bucket}.`,
      );
    }
  }
}

async function findOtp(mailpitUrl, recipient) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const listResponse = await fetch(`${mailpitUrl}/api/v1/messages`);
    if (!listResponse.ok) {
      throw new Error(`Mailpit listing failed with ${listResponse.status}.`);
    }
    const list = await listResponse.json();
    const messages = list.messages ?? list.Messages ?? [];

    for (const message of messages) {
      const recipients = message.To ?? message.to ?? [];
      const addresses = recipients.map((entry) =>
        typeof entry === "string" ? entry : (entry.Address ?? entry.address),
      );
      if (!addresses.includes(recipient)) continue;

      const messageId = message.ID ?? message.Id ?? message.id;
      const messageResponse = await fetch(
        `${mailpitUrl}/api/v1/message/${messageId}`,
      );
      if (!messageResponse.ok) {
        throw new Error(
          `Mailpit message read failed with ${messageResponse.status}.`,
        );
      }
      const detail = await messageResponse.json();
      const content = [detail.Text, detail.HTML, detail.Raw]
        .filter((value) => typeof value === "string")
        .join("\n");
      const code = content.match(/\b\d{6}\b/u)?.[0];
      if (code) return code;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("The local OTP email did not arrive in Mailpit.");
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
    const diagnostic = [error.stdout, error.stderr]
      .map((value) => value?.toString().trim())
      .filter(Boolean)
      .join("\n");
    throw new Error(
      `Local database query failed${diagnostic ? `: ${diagnostic}` : "."}`,
      { cause: error },
    );
  }
}

const PHASE_2D_PROVISIONER = "10000000-0000-4000-8000-000000000091";
const PHASE_2D_PROVISIONER_SESSION = "71000000-0000-4000-8000-000000000091";
const PHASE_2D_DELIVERY_WORKER = "10000000-0000-4000-8000-000000000092";
const PHASE_2D_DELIVERY_SESSION = "71000000-0000-4000-8000-000000000092";

function installPhase2dTestWorkers() {
  runDatabaseQuery(`
    do $phase_2d_workers$
    begin
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    values
      ('${PHASE_2D_PROVISIONER}'::uuid, 'auth-harness-provisioner@example.test', statement_timestamp(), '{}'),
      ('${PHASE_2D_DELIVERY_WORKER}'::uuid, 'auth-harness-delivery@example.test', statement_timestamp(), '{}')
    on conflict (id) do nothing;

    insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
    values
      ('${PHASE_2D_PROVISIONER_SESSION}'::uuid, '${PHASE_2D_PROVISIONER}'::uuid, statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '1 day'),
      ('${PHASE_2D_DELIVERY_SESSION}'::uuid, '${PHASE_2D_DELIVERY_WORKER}'::uuid, statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '1 day')
    on conflict (id) do nothing;

    insert into private.invitation_provisioner_allowlist (auth_user_id)
    values ('${PHASE_2D_PROVISIONER}'::uuid)
    on conflict (auth_user_id) do nothing;
    insert into private.invitation_delivery_worker_allowlist (auth_user_id)
    values ('${PHASE_2D_DELIVERY_WORKER}'::uuid)
    on conflict (auth_user_id) do nothing;

    update private.invitation_delivery_capabilities
       set enabled = true, updated_at = statement_timestamp()
     where capability = 'email_delivery';
    end
    $phase_2d_workers$;
  `);
}

function installSyntheticFamilySessions() {
  runDatabaseQuery(`
    insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
    select auth_user.id, auth_user.id, statement_timestamp(),
      statement_timestamp(), statement_timestamp() + interval '1 day'
      from auth.users as auth_user
    on conflict (id) do update
      set user_id = excluded.user_id,
          updated_at = excluded.updated_at,
          not_after = excluded.not_after;
  `);
  runDatabaseQuery(`
    do $install_service_canary$
    begin
      execute $definition$
        create function public.phase_test_service_pre_request_canary()
        returns boolean
        language sql stable security invoker set search_path = '' as $body$
          select true;
        $body$
      $definition$;
      execute 'revoke all on function public.phase_test_service_pre_request_canary() from public, anon, authenticated, service_role';
      execute 'grant execute on function public.phase_test_service_pre_request_canary() to service_role';
      perform pg_catalog.pg_notify('pgrst', 'reload schema');
    end
    $install_service_canary$;
  `);
}

function materializeDeliveredPhase2dInvitation({
  emailRequestId,
  rawToken,
  targetAuthUserId,
}) {
  runDatabaseQuery(`
    do $phase_2d_fixture$
    declare
      target_job_id uuid;
      target_invitation_id uuid;
      target_delivery_version integer;
      target_token_sha256 text := encode(
        extensions.digest('${rawToken}', 'sha256'), 'hex'
      );
      target_binding text;
    begin
      perform set_config(
        'request.jwt.claims',
        '{"sub":"${PHASE_2D_PROVISIONER}","session_id":"${PHASE_2D_PROVISIONER_SESSION}"}',
        true
      );
      select invitation_job_id into target_job_id
        from private.complete_invitation_email_provisioning(
          '${emailRequestId}'::uuid,
          '${targetAuthUserId}'::uuid
        );
      if target_job_id is null then
        raise exception 'Phase 2D fixture provisioning returned no job';
      end if;

      perform set_config(
        'request.jwt.claims',
        '{"sub":"${PHASE_2D_DELIVERY_WORKER}","session_id":"${PHASE_2D_DELIVERY_SESSION}"}',
        true
      );
      select invitation_id, delivery_version
        into target_invitation_id, target_delivery_version
        from private.materialize_invitation_delivery_job(
          target_job_id, 1, target_token_sha256
        );
      select recipient_binding_hex into target_binding
        from private.read_invitation_delivery_auth(target_job_id);
      if target_invitation_id is null or target_binding is null then
        raise exception 'Phase 2D fixture materialization was incomplete';
      end if;
      perform private.complete_invitation_delivery(
        target_job_id,
        target_invitation_id,
        target_delivery_version,
        target_token_sha256,
        target_binding,
        'local-harness',
        'auth-harness-' || target_job_id::text,
        'auth-harness/' || target_job_id::text,
        repeat('a', 64),
        statement_timestamp()
      );
    end
    $phase_2d_fixture$;
  `);
}

async function createDeliveredPhase2dInvitation({
  apiUrl,
  circleId,
  displayName,
  email,
  organizerToken,
  publishableKey,
  targetAuthUserId,
}) {
  const requested = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/request_invitation_email`,
    publishableKey,
    {
      body: JSON.stringify({
        circle_id: circleId,
        display_name: displayName,
        email,
        request_key: randomUUID(),
      }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  if (!requested.response.ok || typeof requested.body !== "string") {
    throw new Error(
      `Phase 2D invitation request failed with ${requested.response.status}.`,
    );
  }
  const rawToken = `invite-${randomUUID()}`;
  materializeDeliveredPhase2dInvitation({
    emailRequestId: requested.body,
    rawToken,
    targetAuthUserId,
  });
  return { emailRequestId: requested.body, rawToken };
}

const CIRCLE_A = "20000000-0000-4000-8000-000000000001";
const CIRCLE_B = "20000000-0000-4000-8000-000000000002";
const ORGANIZER_A = "10000000-0000-4000-8000-000000000001";
const DUAL_CIRCLE_USER = "10000000-0000-4000-8000-000000000005";
const DUAL_CIRCLE_A_MEMBERSHIP = "40000000-0000-4000-8000-000000000005";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

let shouldRestoreFixtures = false;
let storageCleanup = null;
let primaryError = null;

try {
  const status = await readLocalStatus();
  const apiUrl = status.API_URL;
  const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  const jwtSecret = status.JWT_SECRET;
  const mailpitUrl = status.MAILPIT_URL ?? status.INBUCKET_URL;

  if (!apiUrl || !anonKey || !serviceKey || !jwtSecret || !mailpitUrl) {
    throw new Error("Local Supabase status omitted an Auth integration value.");
  }

  shouldRestoreFixtures = true;
  installSyntheticFamilySessions();
  installPhase2dTestWorkers();
  const suffix = randomUUID();
  const invitedEmail = `auth-invite-${suffix}@example.test`;
  const rawSignupEmail = `raw-signup-${suffix}@example.test`;
  const unknownOtpAttempts = [
    {
      body: {
        create_user: false,
        email: `unknown-otp-no-create-${suffix}@example.test`,
      },
      label: "create_user=false",
    },
    {
      body: {
        create_user: true,
        email: `unknown-otp-create-${suffix}@example.test`,
      },
      label: "create_user=true",
    },
    {
      body: { email: `unknown-otp-default-${suffix}@example.test` },
      label: "create_user omitted",
    },
  ];

  const rawSignup = await jsonRequest(`${apiUrl}/auth/v1/signup`, anonKey, {
    body: JSON.stringify({
      email: rawSignupEmail,
      password: `Local-only-${suffix}`,
    }),
    method: "POST",
  });
  if (rawSignup.response.ok) {
    throw new Error("Raw public signup unexpectedly created an account.");
  }

  for (const attempt of unknownOtpAttempts) {
    const unknownOtp = await jsonRequest(`${apiUrl}/auth/v1/otp`, anonKey, {
      body: JSON.stringify(attempt.body),
      method: "POST",
    });
    if (attempt.body.create_user === false && unknownOtp.response.ok) {
      throw new Error(
        `Unknown-email OTP unexpectedly succeeded with ${attempt.label}.`,
      );
    }
  }

  const adminHeaders = { authorization: `Bearer ${serviceKey}` };
  const createdUser = await jsonRequest(
    `${apiUrl}/auth/v1/admin/users`,
    serviceKey,
    {
      body: JSON.stringify({ email: invitedEmail, email_confirm: true }),
      headers: adminHeaders,
      method: "POST",
    },
  );
  if (!createdUser.response.ok || !createdUser.body?.id) {
    throw new Error(
      `Local trusted-user provisioning failed with ${createdUser.response.status}.`,
    );
  }

  const organizerToken = createLocalUserToken(ORGANIZER_A, jwtSecret);
  const organizerHeaders = { authorization: `Bearer ${organizerToken}` };
  const liveCircleRead = await jsonRequest(
    `${apiUrl}/rest/v1/circles?select=id`,
    anonKey,
    { headers: organizerHeaders },
  );
  if (!liveCircleRead.response.ok || liveCircleRead.body?.length !== 1) {
    throw new Error(
      "A matching live session could not read its family circle.",
    );
  }

  let serviceCanary;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    serviceCanary = await jsonRequest(
      `${apiUrl}/rest/v1/rpc/phase_test_service_pre_request_canary`,
      serviceKey,
      {
        body: "{}",
        headers: { authorization: `Bearer ${serviceKey}` },
        method: "POST",
      },
    );
    if (serviceCanary.response.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!serviceCanary?.response.ok || serviceCanary.body !== true) {
    throw new Error("The service control plane was blocked by user sessions.");
  }

  const rawReservation = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/reserve_photo_intake`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        journal_person_id: "30000000-0000-4000-8000-000000000001",
        request_key: randomUUID(),
      }),
      headers: organizerHeaders,
      method: "POST",
    },
  );
  if (rawReservation.response.ok || rawReservation.body?.code !== "42501") {
    throw new Error("The retired raw reservation RPC remained executable.");
  }

  runDatabaseQuery(`
    delete from auth.sessions where id = '${ORGANIZER_A}'::uuid;
  `);
  const staleSessionRequests = [
    [
      "direct family-table read",
      await jsonRequest(`${apiUrl}/rest/v1/circles?select=id`, anonKey, {
        headers: organizerHeaders,
      }),
    ],
    [
      "family read RPC",
      await jsonRequest(`${apiUrl}/rest/v1/rpc/list_memory_years`, anonKey, {
        body: JSON.stringify({ circle_id: CIRCLE_A }),
        headers: organizerHeaders,
        method: "POST",
      }),
    ],
    [
      "family mutation RPC",
      await jsonRequest(
        `${apiUrl}/rest/v1/rpc/request_family_export`,
        anonKey,
        {
          body: JSON.stringify({
            circle_id: CIRCLE_A,
            request_key: randomUUID(),
          }),
          headers: organizerHeaders,
          method: "POST",
        },
      ),
    ],
    [
      "invitation acceptance RPC",
      await jsonRequest(`${apiUrl}/rest/v1/rpc/accept_invitation`, anonKey, {
        body: JSON.stringify({ token: "stale-session-must-stop-first" }),
        headers: organizerHeaders,
        method: "POST",
      }),
    ],
  ];
  for (const [label, result] of staleSessionRequests) {
    if (
      result.response.ok ||
      result.body?.code !== "42501" ||
      result.body?.message !== "Family session is unavailable"
    ) {
      throw new Error(`A stale session reached the ${label}.`);
    }
  }
  runDatabaseQuery(`
    insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
    values (
      '${ORGANIZER_A}'::uuid, '${ORGANIZER_A}'::uuid,
      statement_timestamp(), statement_timestamp(),
      statement_timestamp() + interval '1 day'
    );
  `);

  const invitation = await createDeliveredPhase2dInvitation({
    apiUrl,
    circleId: CIRCLE_A,
    displayName: "Auth Integration Invite",
    email: invitedEmail,
    organizerToken,
    publishableKey: anonKey,
    targetAuthUserId: createdUser.body.id,
  });

  const otpRequest = await jsonRequest(`${apiUrl}/auth/v1/otp`, anonKey, {
    body: JSON.stringify({ create_user: false, email: invitedEmail }),
    method: "POST",
  });
  if (!otpRequest.response.ok) {
    throw new Error(
      `Known-user OTP failed with ${otpRequest.response.status}.`,
    );
  }

  const otp = await findOtp(mailpitUrl, invitedEmail);
  const verified = await jsonRequest(`${apiUrl}/auth/v1/verify`, anonKey, {
    body: JSON.stringify({ email: invitedEmail, token: otp, type: "email" }),
    method: "POST",
  });
  const accessToken = verified.body?.access_token;
  if (!verified.response.ok || !accessToken) {
    throw new Error(
      `OTP verification failed with ${verified.response.status}.`,
    );
  }

  const userHeaders = { authorization: `Bearer ${accessToken}` };
  const beforeAcceptance = await jsonRequest(
    `${apiUrl}/rest/v1/circles?select=id`,
    anonKey,
    { headers: userHeaders },
  );
  if (!beforeAcceptance.response.ok || beforeAcceptance.body?.length !== 0) {
    throw new Error(
      "A provisioned user gained circle access before acceptance.",
    );
  }

  const wrongUserAcceptance = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/accept_invitation`,
    anonKey,
    {
      body: JSON.stringify({ token: invitation.rawToken }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  if (!wrongUserAcceptance.response.ok || wrongUserAcceptance.body !== null) {
    throw new Error(
      "A wrong Auth identity could consume a target-bound invite.",
    );
  }

  const accepted = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/accept_invitation`,
    anonKey,
    {
      body: JSON.stringify({ token: invitation.rawToken }),
      headers: userHeaders,
      method: "POST",
    },
  );
  if (!accepted.response.ok || typeof accepted.body !== "string") {
    throw new Error(
      `Invitation acceptance failed with ${accepted.response.status}.`,
    );
  }

  const acceptanceReplay = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/accept_invitation`,
    anonKey,
    {
      body: JSON.stringify({ token: invitation.rawToken }),
      headers: userHeaders,
      method: "POST",
    },
  );
  if (!acceptanceReplay.response.ok || acceptanceReplay.body !== null) {
    throw new Error("Invitation acceptance replay created another membership.");
  }

  const afterAcceptance = await jsonRequest(
    `${apiUrl}/rest/v1/circles?select=id,name`,
    anonKey,
    { headers: userHeaders },
  );
  if (
    !afterAcceptance.response.ok ||
    afterAcceptance.body?.length !== 1 ||
    afterAcceptance.body[0]?.id !== CIRCLE_A
  ) {
    throw new Error(
      "Accepted membership did not expose exactly its own circle.",
    );
  }

  const promoted = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/set_membership_role`,
    anonKey,
    {
      body: JSON.stringify({ membership_id: accepted.body, role: "organizer" }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  if (!promoted.response.ok) {
    throw new Error(
      `Membership promotion failed with ${promoted.response.status}.`,
    );
  }

  const preRevocationMarker = `Pre-revocation authority ${suffix}`;
  const preRevocationMutation = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/request_invitation_email`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        display_name: preRevocationMarker,
        email: `pre-revocation-${suffix}@example.test`,
        request_key: randomUUID(),
      }),
      headers: userHeaders,
      method: "POST",
    },
  );
  if (
    !preRevocationMutation.response.ok ||
    !uuid.test(preRevocationMutation.body)
  ) {
    throw new Error(
      `The live token lacked expected organizer authority before revocation (${preRevocationMutation.response.status}).`,
    );
  }

  const displayCanary = await sharp({
    create: {
      background: { alpha: 1, b: 64, g: 96, r: 128 },
      channels: 4,
      height: 1,
      width: 1,
    },
  })
    .webp({ effort: 0, quality: 80 })
    .toBuffer();
  const storageObjects = [
    {
      body: Buffer.from(`private storage canary ${suffix}`, "utf8"),
      bucket: "our-days-originals",
      contentType: "text/plain",
      deniedUploadPath: `phase-2/denied-${suffix}.txt`,
      seededPath: `phase-2/private-${suffix}.txt`,
    },
    {
      body: displayCanary,
      bucket: "our-days-display",
      contentType: "image/webp",
      deniedUploadPath: `phase-2/denied-${suffix}.webp`,
      seededPath: `phase-2/private-${suffix}.webp`,
    },
  ];
  storageCleanup = async () => {
    for (const { bucket, deniedUploadPath, seededPath } of storageObjects) {
      await storageRequest(apiUrl, serviceKey, serviceKey, `object/${bucket}`, {
        body: JSON.stringify({ prefixes: [seededPath, deniedUploadPath] }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
    }
  };

  for (const {
    body,
    bucket,
    contentType,
    deniedUploadPath,
    seededPath,
  } of storageObjects) {
    const seeded = await storageRequest(
      apiUrl,
      serviceKey,
      serviceKey,
      `object/${bucket}/${seededPath}`,
      {
        body,
        headers: { "content-type": contentType, "x-upsert": "false" },
        method: "POST",
      },
    );
    if (!seeded.ok) {
      throw new Error(
        `Service-role Storage fixture upload failed for ${bucket} with ${seeded.status}.`,
      );
    }

    const publicRead = await fetch(
      `${apiUrl}/storage/v1/object/public/${bucket}/${seededPath}`,
    );
    if (publicRead.ok) {
      throw new Error(`Private bucket ${bucket} exposed a public object URL.`);
    }

    await assertStorageDenied(
      apiUrl,
      anonKey,
      anonKey,
      "anonymous caller",
      bucket,
      seededPath,
      deniedUploadPath,
    );
    await assertStorageDenied(
      apiUrl,
      anonKey,
      accessToken,
      "active authenticated caller",
      bucket,
      seededPath,
      deniedUploadPath,
    );
  }

  const revoked = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/revoke_membership`,
    anonKey,
    {
      body: JSON.stringify({ membership_id: accepted.body }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  if (!revoked.response.ok) {
    throw new Error(
      `Membership revocation failed with ${revoked.response.status}.`,
    );
  }

  const afterRevocation = await jsonRequest(
    `${apiUrl}/rest/v1/circles?select=id`,
    anonKey,
    { headers: userHeaders },
  );
  if (!afterRevocation.response.ok || afterRevocation.body?.length !== 0) {
    throw new Error(
      "A stale access token retained data after membership revocation.",
    );
  }

  const postRevocationMarker = `Post-revocation denial ${suffix}`;
  const staleMutation = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/request_invitation_email`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        display_name: postRevocationMarker,
        email: `post-revocation-${suffix}@example.test`,
        request_key: randomUUID(),
      }),
      headers: userHeaders,
      method: "POST",
    },
  );
  if (
    staleMutation.response.ok ||
    staleMutation.body?.code !== "42501" ||
    staleMutation.body?.message !== "Invitation email could not be requested"
  ) {
    throw new Error(
      `A stale organizer token did not follow the generic mutation-denial path (${staleMutation.response.status}).`,
    );
  }

  const pendingInvitations = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/list_pending_invitation_email_requests`,
    anonKey,
    {
      body: JSON.stringify({ circle_id: CIRCLE_A }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  if (
    !pendingInvitations.response.ok ||
    pendingInvitations.body?.some(
      (invitation) => invitation.invited_display_name === preRevocationMarker,
    ) ||
    pendingInvitations.body?.some(
      (invitation) => invitation.invited_display_name === postRevocationMarker,
    )
  ) {
    throw new Error(
      `The stale-token mutation boundary did not preserve the expected invitation state (${pendingInvitations.response.status}: ${JSON.stringify(pendingInvitations.body)}).`,
    );
  }
  runDatabaseQuery(`
    do $stale_invitation_audit$
    begin
      if not exists (
        select 1
          from private.invitation_email_requests as request
         where request.id = '${preRevocationMutation.body}'::uuid
           and request.state = 'invalidated'
           and request.invalidation_reason = 'requester_authority_lost'
           and request.normalized_email is null
      ) then
        raise exception 'Requester revocation did not invalidate queued invitation work';
      end if;
    end
    $stale_invitation_audit$;
  `);

  for (const { bucket, deniedUploadPath, seededPath } of storageObjects) {
    await assertStorageDenied(
      apiUrl,
      anonKey,
      accessToken,
      "revoked caller with a stale token",
      bucket,
      seededPath,
      deniedUploadPath,
    );
  }

  const dualCircleToken = createLocalUserToken(DUAL_CIRCLE_USER, jwtSecret);
  const dualCircleHeaders = { authorization: `Bearer ${dualCircleToken}` };
  const revokedDualCircleA = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/revoke_membership`,
    anonKey,
    {
      body: JSON.stringify({ membership_id: DUAL_CIRCLE_A_MEMBERSHIP }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  if (!revokedDualCircleA.response.ok) {
    throw new Error("Dual-circle membership A could not be revoked.");
  }
  const dualCircleRead = await jsonRequest(
    `${apiUrl}/rest/v1/circles?select=id`,
    anonKey,
    { headers: dualCircleHeaders },
  );
  if (
    !dualCircleRead.response.ok ||
    dualCircleRead.body?.length !== 1 ||
    dualCircleRead.body[0]?.id !== CIRCLE_B
  ) {
    throw new Error("Revoking circle A also damaged the live circle B grant.");
  }
  const deniedDualCircleA = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/request_invitation_email`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        display_name: "Revoked A must fail",
        email: `dual-a-${suffix}@example.test`,
        request_key: randomUUID(),
      }),
      headers: dualCircleHeaders,
      method: "POST",
    },
  );
  if (deniedDualCircleA.response.ok) {
    throw new Error("The dual-circle stale token retained circle A authority.");
  }
  const allowedDualCircleB = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/request_invitation_email`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: CIRCLE_B,
        display_name: "Circle B remains live",
        email: `dual-b-${suffix}@example.test`,
        request_key: randomUUID(),
      }),
      headers: dualCircleHeaders,
      method: "POST",
    },
  );
  if (!allowedDualCircleB.response.ok) {
    throw new Error("Revoking circle A removed valid circle B authority.");
  }

  const closureRequest = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/request_account_closure`,
    anonKey,
    {
      body: JSON.stringify({ request_key: randomUUID() }),
      headers: dualCircleHeaders,
      method: "POST",
    },
  );
  if (
    !closureRequest.response.ok ||
    typeof closureRequest.body !== "string" ||
    !uuid.test(closureRequest.body)
  ) {
    throw new Error(
      `Account closure request failed with ${closureRequest.response.status}.`,
    );
  }

  const requestedClosureRead = await jsonRequest(
    `${apiUrl}/rest/v1/circles?select=id`,
    anonKey,
    { headers: dualCircleHeaders },
  );
  if (
    requestedClosureRead.response.ok ||
    requestedClosureRead.body?.code !== "42501" ||
    requestedClosureRead.body?.message !== "Family session is unavailable"
  ) {
    throw new Error(
      "A requested account closure retained ordinary family reads.",
    );
  }

  runDatabaseQuery(`
    with role_set as materialized (
      select pg_catalog.set_config('role', 'service_role', true)
    )
    select private.prepare_account_closure('${closureRequest.body}'::uuid)
      from role_set;
  `);

  const preparedClosureRead = await jsonRequest(
    `${apiUrl}/rest/v1/circles?select=id`,
    anonKey,
    { headers: dualCircleHeaders },
  );
  if (
    preparedClosureRead.response.ok ||
    preparedClosureRead.body?.code !== "42501" ||
    preparedClosureRead.body?.message !== "Family session is unavailable"
  ) {
    throw new Error(
      "A captured access token retained family reads after closure preparation.",
    );
  }

  const preparedClosureMutation = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/request_invitation_email`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: CIRCLE_B,
        display_name: "Prepared closure must fail",
        email: `prepared-closure-${suffix}@example.test`,
        request_key: randomUUID(),
      }),
      headers: dualCircleHeaders,
      method: "POST",
    },
  );
  if (
    preparedClosureMutation.response.ok ||
    preparedClosureMutation.body?.code !== "42501" ||
    preparedClosureMutation.body?.message !== "Family session is unavailable"
  ) {
    throw new Error(
      `A captured access token did not follow the generic post-closure mutation-denial path (${preparedClosureMutation.response.status}).`,
    );
  }

  for (const { bucket, deniedUploadPath, seededPath } of storageObjects) {
    await assertStorageDenied(
      apiUrl,
      anonKey,
      dualCircleToken,
      "prepared account caller with a captured token",
      bucket,
      seededPath,
      deniedUploadPath,
    );
  }

  const userEmails = [];
  for (let page = 1; page <= 20; page += 1) {
    const users = await jsonRequest(
      `${apiUrl}/auth/v1/admin/users?page=${page}&per_page=50`,
      serviceKey,
      { headers: adminHeaders },
    );
    if (!users.response.ok) {
      throw new Error(
        `Auth admin user list failed on page ${page} with ${users.response.status}: ${JSON.stringify(users.body)}`,
      );
    }
    const pageEmails = (users.body?.users ?? []).map((user) => user.email);
    userEmails.push(...pageEmails);
    if (pageEmails.length < 50) break;
  }
  const deniedAuthEmails = [
    rawSignupEmail,
    ...unknownOtpAttempts.map((attempt) => attempt.body.email),
  ];
  const persistedDeniedEmails = deniedAuthEmails.filter((email) =>
    userEmails.includes(email),
  );
  if (persistedDeniedEmails.length > 0) {
    throw new Error(
      `A denied public Auth path still persisted an account: ${persistedDeniedEmails.join(", ")}`,
    );
  }

  process.stdout.write(
    "Local Auth signup variants, OTP, invite acceptance, membership and prepared-closure stale-token denial, and closed Storage HTTP paths passed.\n",
  );
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  if (storageCleanup) {
    await storageCleanup().catch(() => undefined);
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
