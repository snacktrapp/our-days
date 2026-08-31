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
    throw new Error("Local database query failed.", { cause: error });
  }
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
  const invitation = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/create_invitation`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        display_name: "Auth Integration Invite",
        email: invitedEmail,
      }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  const invitationResult = invitation.body?.[0];
  if (!invitation.response.ok || !invitationResult?.raw_token) {
    throw new Error(
      `Invitation creation failed with ${invitation.response.status}.`,
    );
  }

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

  const accepted = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/accept_invitation`,
    anonKey,
    {
      body: JSON.stringify({ token: invitationResult.raw_token }),
      headers: userHeaders,
      method: "POST",
    },
  );
  if (!accepted.response.ok || typeof accepted.body !== "string") {
    throw new Error(
      `Invitation acceptance failed with ${accepted.response.status}.`,
    );
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
    `${apiUrl}/rest/v1/rpc/create_invitation`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        display_name: preRevocationMarker,
        email: `pre-revocation-${suffix}@example.test`,
      }),
      headers: userHeaders,
      method: "POST",
    },
  );
  if (!preRevocationMutation.response.ok) {
    throw new Error(
      `The live token lacked expected organizer authority before revocation (${preRevocationMutation.response.status}).`,
    );
  }

  const storageObjects = ["our-days-originals", "our-days-display"].map(
    (bucket) => ({
      bucket,
      deniedUploadPath: `phase-2/denied-${suffix}.txt`,
      seededPath: `phase-2/private-${suffix}.txt`,
    }),
  );
  storageCleanup = async () => {
    for (const { bucket, deniedUploadPath, seededPath } of storageObjects) {
      await storageRequest(apiUrl, serviceKey, serviceKey, `object/${bucket}`, {
        body: JSON.stringify({ prefixes: [seededPath, deniedUploadPath] }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
    }
  };

  for (const { bucket, deniedUploadPath, seededPath } of storageObjects) {
    const seeded = await storageRequest(
      apiUrl,
      serviceKey,
      serviceKey,
      `object/${bucket}/${seededPath}`,
      {
        body: Buffer.from(`private storage canary ${suffix}`, "utf8"),
        headers: { "content-type": "text/plain", "x-upsert": "false" },
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
    `${apiUrl}/rest/v1/rpc/create_invitation`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        display_name: postRevocationMarker,
        email: `post-revocation-${suffix}@example.test`,
      }),
      headers: userHeaders,
      method: "POST",
    },
  );
  if (
    staleMutation.response.ok ||
    staleMutation.body?.code !== "42501" ||
    staleMutation.body?.message !== "Invitation could not be created"
  ) {
    throw new Error(
      `A stale organizer token did not follow the generic mutation-denial path (${staleMutation.response.status}).`,
    );
  }

  const pendingInvitations = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/list_pending_invitations`,
    anonKey,
    {
      body: JSON.stringify({ circle_id: CIRCLE_A }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  if (
    !pendingInvitations.response.ok ||
    !pendingInvitations.body?.some(
      (invitation) => invitation.display_name === preRevocationMarker,
    ) ||
    pendingInvitations.body?.some(
      (invitation) => invitation.display_name === postRevocationMarker,
    )
  ) {
    throw new Error(
      "The stale-token mutation boundary did not preserve the expected invitation state.",
    );
  }

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
    `${apiUrl}/rest/v1/rpc/create_invitation`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: CIRCLE_A,
        display_name: "Revoked A must fail",
        email: `dual-a-${suffix}@example.test`,
      }),
      headers: dualCircleHeaders,
      method: "POST",
    },
  );
  if (deniedDualCircleA.response.ok) {
    throw new Error("The dual-circle stale token retained circle A authority.");
  }
  const allowedDualCircleB = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/create_invitation`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: CIRCLE_B,
        display_name: "Circle B remains live",
        email: `dual-b-${suffix}@example.test`,
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
    !requestedClosureRead.response.ok ||
    requestedClosureRead.body?.length !== 1 ||
    requestedClosureRead.body[0]?.id !== CIRCLE_B
  ) {
    throw new Error(
      "A requested account closure changed ordinary family reads before preparation.",
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
    !preparedClosureRead.response.ok ||
    preparedClosureRead.body?.length !== 0
  ) {
    throw new Error(
      "A captured access token retained family reads after closure preparation.",
    );
  }

  const preparedClosureMutation = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/create_invitation`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: CIRCLE_B,
        display_name: "Prepared closure must fail",
        email: `prepared-closure-${suffix}@example.test`,
      }),
      headers: dualCircleHeaders,
      method: "POST",
    },
  );
  if (
    preparedClosureMutation.response.ok ||
    preparedClosureMutation.body?.code !== "42501" ||
    preparedClosureMutation.body?.message !== "Invitation could not be created"
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

  const users = await jsonRequest(
    `${apiUrl}/auth/v1/admin/users?page=1&per_page=1000`,
    serviceKey,
    { headers: adminHeaders },
  );
  const userEmails = (users.body?.users ?? []).map((user) => user.email);
  const deniedAuthEmails = [
    rawSignupEmail,
    ...unknownOtpAttempts.map((attempt) => attempt.body.email),
  ];
  if (
    !users.response.ok ||
    deniedAuthEmails.some((email) => userEmails.includes(email))
  ) {
    throw new Error("A denied public Auth path still persisted an account.");
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
