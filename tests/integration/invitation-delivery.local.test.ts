import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deriveInvitationToken,
  runInvitationProvisioner,
  runInvitationWorker,
} from "../../src/lib/invitation-worker";
import { SupabaseInvitationAuthAdminAdapter } from "../../src/lib/invitation-worker/supabase-auth-admin-adapter";
import {
  SupabaseInvitationDeliveryCoordinator,
  SupabaseInvitationProvisioningCoordinator,
} from "../../src/lib/invitation-worker/supabase-coordinator-adapter";
import { LocalMailpitInvitationProvider } from "../../scripts/lib/mailpit-invitation-provider.mjs";

const enabled = process.env.OUR_DAYS_LOCAL_INVITATION_INTEGRATION === "1";
const projectRoot = resolve(process.cwd());
const supabaseBinary = resolve(projectRoot, "node_modules/.bin/supabase");
const CIRCLE_A = "20000000-0000-4000-8000-000000000001";
const ORGANIZER_A = "10000000-0000-4000-8000-000000000001";
const workerKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

type LocalStatus = Record<string, string>;

function readLocalStatus(): LocalStatus {
  const output = execFileSync(supabaseBinary, ["status", "-o", "env"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (output.trimStart().startsWith("{")) return JSON.parse(output);
  return Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/u))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1] ?? "", match[2] ?? ""]),
  );
}

function resetDatabase() {
  execFileSync(supabaseBinary, ["db", "reset", "--local"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function queryDatabase(sql: string) {
  try {
    execFileSync(supabaseBinary, ["db", "query", "--local", sql], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stdout =
      error instanceof Error && "stdout" in error
        ? String(error.stdout).trim()
        : "";
    const stderr =
      error instanceof Error && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    const diagnostic = [stdout, stderr].filter(Boolean).join("\n");
    throw new Error(
      `Local database setup failed: ${diagnostic || "No database diagnostic was returned."}`,
    );
  }
}

function localToken(userId: string, jwtSecret: string) {
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      aud: "authenticated",
      exp: now + 3_600,
      iat: now,
      iss: "supabase-demo",
      role: "authenticated",
      sub: userId,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function requestJson(
  url: string,
  apiKey: string,
  init: RequestInit = {},
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: apiKey,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  let value: unknown = null;
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  }
  return { response, value };
}

function diagnosticRpcFetch(diagnostics: string[]): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    const pathname = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    ).pathname;
    if (!response.ok) {
      let code = "unknown";
      let message = "RPC request failed";
      try {
        const value = (await response.clone().json()) as Record<
          string,
          unknown
        >;
        if (typeof value.code === "string") code = value.code;
        if (typeof value.message === "string") message = value.message;
      } catch {
        // The response body is deliberately not copied into diagnostics.
      }
      diagnostics.push(`${pathname} (${response.status}, ${code}): ${message}`);
    } else if (pathname.includes("/rest/v1/rpc/")) {
      try {
        const value = (await response.clone().json()) as unknown;
        const shape = Array.isArray(value)
          ? value.length === 0
            ? "empty array"
            : typeof value[0] === "object" && value[0] !== null
              ? `row keys=${Object.keys(value[0]).sort().join(",")}`
              : `array item=${typeof value[0]}`
          : `scalar=${typeof value}`;
        diagnostics.push(`${pathname} (${response.status}): ${shape}`);
      } catch {
        diagnostics.push(`${pathname} (${response.status}): unreadable JSON`);
      }
    }
    return response;
  };
}

async function createAdminUser(
  apiUrl: string,
  serviceKey: string,
  email: string,
  confirmed: boolean,
  password?: string,
) {
  const created = await requestJson(
    `${apiUrl}/auth/v1/admin/users`,
    serviceKey,
    {
      body: JSON.stringify({
        email,
        email_confirm: confirmed,
        ...(password ? { password } : {}),
      }),
      headers: { authorization: `Bearer ${serviceKey}` },
      method: "POST",
    },
  );
  const id =
    typeof created.value === "object" &&
    created.value !== null &&
    "id" in created.value &&
    typeof created.value.id === "string"
      ? created.value.id
      : null;
  if (!created.response.ok || !id) {
    throw new Error(
      `Local worker user creation failed (${created.response.status}).`,
    );
  }
  return id;
}

async function signInWithPassword(
  apiUrl: string,
  publishableKey: string,
  email: string,
  password: string,
) {
  const signedIn = await requestJson(
    `${apiUrl}/auth/v1/token?grant_type=password`,
    publishableKey,
    {
      body: JSON.stringify({ email, password }),
      method: "POST",
    },
  );
  const accessToken =
    typeof signedIn.value === "object" &&
    signedIn.value !== null &&
    "access_token" in signedIn.value &&
    typeof signedIn.value.access_token === "string"
      ? signedIn.value.access_token
      : null;
  if (!signedIn.response.ok || !accessToken) {
    const diagnostic =
      typeof signedIn.value === "object" && signedIn.value !== null
        ? Object.fromEntries(
            Object.entries(signedIn.value).filter(([key]) =>
              ["code", "error_code", "message", "msg"].includes(key),
            ),
          )
        : { bodyType: typeof signedIn.value };
    throw new Error(
      `Local worker sign-in failed (${signedIn.response.status}): ${JSON.stringify(diagnostic)}`,
    );
  }
  return accessToken;
}

async function findMail(
  mailpitUrl: string,
  recipient: string,
  predicate: (content: string) => string | null,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const list = await fetch(`${mailpitUrl}/api/v1/messages`);
    if (!list.ok) throw new Error("Mailpit message listing failed.");
    const listing = (await list.json()) as Record<string, unknown>;
    const messages = (listing.messages ?? listing.Messages ?? []) as Array<
      Record<string, unknown>
    >;
    for (const message of messages) {
      const recipients = (message.To ?? message.to ?? []) as Array<
        string | Record<string, unknown>
      >;
      const addresses = recipients.map((entry) =>
        typeof entry === "string"
          ? entry
          : String(entry.Address ?? entry.address ?? ""),
      );
      if (!addresses.includes(recipient)) continue;
      const id = String(message.ID ?? message.Id ?? message.id ?? "");
      const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
      if (!detailResponse.ok) throw new Error("Mailpit message read failed.");
      const detail = (await detailResponse.json()) as Record<string, unknown>;
      const content = [detail.Text, detail.HTML, detail.Raw]
        .filter((part): part is string => typeof part === "string")
        .join("\n");
      const match = predicate(content);
      if (match) return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Expected local invitation mail did not arrive.");
}

describe.skipIf(!enabled)("local invitation provisioning and delivery", () => {
  let status: LocalStatus;
  let apiUrl: string;
  let publishableKey: string;
  let serviceKey: string;
  let jwtSecret: string;
  let mailpitUrl: string;
  let organizerToken: string;
  let provisionerToken: string;
  let deliveryToken: string;
  const recipientEmail = `phase2d-${randomUUID()}@example.test`;

  beforeAll(async () => {
    resetDatabase();
    status = readLocalStatus();
    apiUrl = status.API_URL ?? "";
    publishableKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY ?? "";
    serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY ?? "";
    jwtSecret = status.JWT_SECRET ?? "";
    mailpitUrl = status.MAILPIT_URL ?? status.INBUCKET_URL ?? "";
    if (
      !apiUrl ||
      !publishableKey ||
      !serviceKey ||
      !jwtSecret ||
      !mailpitUrl
    ) {
      throw new Error(
        "Local Supabase omitted invitation integration settings.",
      );
    }

    const provisionerEmail = `phase2d-provisioner-${randomUUID()}@example.test`;
    const deliveryEmail = `phase2d-delivery-${randomUUID()}@example.test`;
    const provisionerPassword = `Local-only-${randomUUID()}`;
    const deliveryPassword = `Local-only-${randomUUID()}`;
    const provisionerId = await createAdminUser(
      apiUrl,
      serviceKey,
      provisionerEmail,
      true,
      provisionerPassword,
    );
    const deliveryId = await createAdminUser(
      apiUrl,
      serviceKey,
      deliveryEmail,
      true,
      deliveryPassword,
    );
    queryDatabase(`
      update private.invitation_delivery_capabilities
         set enabled = true
       where capability = 'email_delivery'
    `);
    queryDatabase(`
      insert into private.invitation_provisioner_allowlist (auth_user_id)
      values ('${provisionerId}'::uuid)
    `);
    queryDatabase(`
      insert into private.invitation_delivery_worker_allowlist (auth_user_id)
      values ('${deliveryId}'::uuid)
    `);
    organizerToken = localToken(ORGANIZER_A, jwtSecret);
    provisionerToken = await signInWithPassword(
      apiUrl,
      publishableKey,
      provisionerEmail,
      provisionerPassword,
    );
    deliveryToken = await signInWithPassword(
      apiUrl,
      publishableKey,
      deliveryEmail,
      deliveryPassword,
    );
  }, 120_000);

  afterAll(() => {
    resetDatabase();
  }, 120_000);

  async function deliverTargetBoundInvitation(
    email: string,
    displayName: string,
  ) {
    const rpcDiagnostics: string[] = [];
    const rpcFetch = diagnosticRpcFetch(rpcDiagnostics);
    const requested = await requestJson(
      `${apiUrl}/rest/v1/rpc/request_invitation_email`,
      publishableKey,
      {
        body: JSON.stringify({
          circle_id: CIRCLE_A,
          email,
          display_name: displayName,
          request_key: randomUUID(),
        }),
        headers: { authorization: `Bearer ${organizerToken}` },
        method: "POST",
      },
    );
    expect(requested.response.ok).toBe(true);
    const requestId = String(requested.value);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/u);

    const authAdmin = new SupabaseInvitationAuthAdminAdapter({
      projectUrl: apiUrl,
      serviceRoleKey: serviceKey,
    });
    const provisioned = await runInvitationProvisioner(requestId, {
      enabled: true,
      authAdmin,
      coordinator: new SupabaseInvitationProvisioningCoordinator({
        projectUrl: apiUrl,
        publishableKey,
        workerAccessToken: provisionerToken,
        fetch: rpcFetch,
      }),
    });
    const delivery = await runInvitationWorker(provisioned.jobId, {
      enabled: true,
      coordinator: new SupabaseInvitationDeliveryCoordinator({
        projectUrl: apiUrl,
        publishableKey,
        workerAccessToken: deliveryToken,
        fetch: rpcFetch,
      }),
      keyring: {
        readKey: async (version) => (version === 1 ? workerKey : null),
      },
      provider: new LocalMailpitInvitationProvider({
        siteOrigin: "http://127.0.0.1:3000",
      }),
    }).catch(() => {
      throw new Error(
        `Invitation delivery failed. RPC diagnostics: ${rpcDiagnostics.join(" | ") || "none"}`,
      );
    });
    expect(delivery).toMatchObject({ state: "delivered" });

    const invitationToken = deriveInvitationToken(
      provisioned.jobId,
      1,
      workerKey,
    );
    await expect(
      findMail(mailpitUrl, email, (content) =>
        content.includes(`/invite#${invitationToken}`) ? invitationToken : null,
      ),
    ).resolves.toBe(invitationToken);
    return { authAdmin, invitationToken, provisioned, requestId };
  }

  async function acceptFamilyInvitation(
    invitationToken: string,
    recipientToken: string,
  ) {
    return requestJson(
      `${apiUrl}/rest/v1/rpc/accept_invitation`,
      publishableKey,
      {
        body: JSON.stringify({ token: invitationToken }),
        headers: { authorization: `Bearer ${recipientToken}` },
        method: "POST",
      },
    );
  }

  it("reinvites an existing confirmed account through sign-in code and target-bound acceptance", async () => {
    const email = `phase2d-confirmed-${randomUUID()}@example.test`;
    const userId = await createAdminUser(apiUrl, serviceKey, email, true);
    const { authAdmin, invitationToken } = await deliverTargetBoundInvitation(
      email,
      "Confirmed Relative",
    );
    const existing = await authAdmin.findByNormalizedEmail(email);
    expect(existing).toMatchObject({ id: userId, email });
    expect(existing?.emailConfirmedAt).toBeTruthy();

    const otp = await findMail(
      mailpitUrl,
      email,
      (content) => content.match(/\b\d{6}\b/u)?.[0] ?? null,
    );
    const wrongType = await requestJson(
      `${apiUrl}/auth/v1/verify`,
      publishableKey,
      {
        body: JSON.stringify({ email, token: otp, type: "invite" }),
        method: "POST",
      },
    );
    expect(wrongType.response.ok).toBe(false);
    const verified = await requestJson(
      `${apiUrl}/auth/v1/verify`,
      publishableKey,
      {
        body: JSON.stringify({ email, token: otp, type: "email" }),
        method: "POST",
      },
    );
    expect(verified.response.ok).toBe(true);
    expect(verified.value).toMatchObject({ user: { id: userId } });
    const recipientToken =
      typeof verified.value === "object" &&
      verified.value !== null &&
      "access_token" in verified.value &&
      typeof verified.value.access_token === "string"
        ? verified.value.access_token
        : "";
    const accepted = await acceptFamilyInvitation(
      invitationToken,
      recipientToken,
    );
    expect(accepted.response.ok).toBe(true);
    expect(accepted.value).toMatch(/^[0-9a-f-]{36}$/u);
  }, 120_000);

  it("renews an orphaned unconfirmed account through invite code and target-bound acceptance", async () => {
    const email = `phase2d-unconfirmed-${randomUUID()}@example.test`;
    const userId = await createAdminUser(apiUrl, serviceKey, email, false);
    const { authAdmin, invitationToken } = await deliverTargetBoundInvitation(
      email,
      "Unconfirmed Relative",
    );
    const existing = await authAdmin.findByNormalizedEmail(email);
    expect(existing).toEqual({ id: userId, email, emailConfirmedAt: null });

    const otp = await findMail(
      mailpitUrl,
      email,
      (content) => content.match(/\b\d{6}\b/u)?.[0] ?? null,
    );
    const verified = await requestJson(
      `${apiUrl}/auth/v1/verify`,
      publishableKey,
      {
        body: JSON.stringify({ email, token: otp, type: "invite" }),
        method: "POST",
      },
    );
    expect(verified.response.ok).toBe(true);
    expect(verified.value).toMatchObject({ user: { id: userId } });
    const recipientToken =
      typeof verified.value === "object" &&
      verified.value !== null &&
      "access_token" in verified.value &&
      typeof verified.value.access_token === "string"
        ? verified.value.access_token
        : "";
    const accepted = await acceptFamilyInvitation(
      invitationToken,
      recipientToken,
    );
    expect(accepted.response.ok).toBe(true);
    expect(accepted.value).toMatch(/^[0-9a-f-]{36}$/u);
  }, 120_000);

  it("provisions unconfirmed, delivers through Mailpit, confirms by OTP, and accepts once", async () => {
    const rpcDiagnostics: string[] = [];
    const rpcFetch = diagnosticRpcFetch(rpcDiagnostics);
    const requested = await requestJson(
      `${apiUrl}/rest/v1/rpc/request_invitation_email`,
      publishableKey,
      {
        body: JSON.stringify({
          circle_id: CIRCLE_A,
          email: recipientEmail,
          display_name: "Phase 2D Relative",
          request_key: randomUUID(),
        }),
        headers: { authorization: `Bearer ${organizerToken}` },
        method: "POST",
      },
    );
    expect(requested.response.ok).toBe(true);
    expect(requested.value).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/u));
    const requestId = String(requested.value);

    const authAdmin = new SupabaseInvitationAuthAdminAdapter({
      projectUrl: apiUrl,
      serviceRoleKey: serviceKey,
    });
    const provisioningCoordinator =
      new SupabaseInvitationProvisioningCoordinator({
        projectUrl: apiUrl,
        publishableKey,
        workerAccessToken: provisionerToken,
        fetch: rpcFetch,
      });
    const provisioned = await runInvitationProvisioner(requestId, {
      enabled: true,
      authAdmin,
      coordinator: provisioningCoordinator,
    });
    const provisionedTarget =
      await authAdmin.findByNormalizedEmail(recipientEmail);
    expect(provisionedTarget).toMatchObject({
      email: recipientEmail,
      emailConfirmedAt: null,
    });

    const provider = new LocalMailpitInvitationProvider({
      siteOrigin: "http://127.0.0.1:3000",
    });
    const deliveryCoordinator = new SupabaseInvitationDeliveryCoordinator({
      projectUrl: apiUrl,
      publishableKey,
      workerAccessToken: deliveryToken,
      fetch: rpcFetch,
    });
    const delivery = await runInvitationWorker(provisioned.jobId, {
      enabled: true,
      coordinator: deliveryCoordinator,
      keyring: {
        readKey: async (version) => (version === 1 ? workerKey : null),
      },
      provider,
    }).catch(() => {
      throw new Error(
        `Invitation delivery failed. RPC diagnostics: ${rpcDiagnostics.join(" | ") || "none"}`,
      );
    });
    expect(delivery).toMatchObject({ state: "delivered" });

    const invitationToken = deriveInvitationToken(
      provisioned.jobId,
      1,
      workerKey,
    );
    const mailedToken = await findMail(mailpitUrl, recipientEmail, (content) =>
      content.includes(`/invite#${invitationToken}`) ? invitationToken : null,
    );
    expect(mailedToken).toBe(invitationToken);

    const otp = await findMail(
      mailpitUrl,
      recipientEmail,
      (content) => content.match(/\b\d{6}\b/u)?.[0] ?? null,
    );
    const verified = await requestJson(
      `${apiUrl}/auth/v1/verify`,
      publishableKey,
      {
        body: JSON.stringify({
          email: recipientEmail,
          token: otp,
          type: "invite",
        }),
        method: "POST",
      },
    );
    expect(verified.response.ok).toBe(true);
    const verifiedUserId =
      typeof verified.value === "object" &&
      verified.value !== null &&
      "user" in verified.value &&
      typeof verified.value.user === "object" &&
      verified.value.user !== null &&
      "id" in verified.value.user &&
      typeof verified.value.user.id === "string"
        ? verified.value.user.id
        : null;
    expect(verifiedUserId).toBe(provisionedTarget?.id);
    const recipientToken =
      typeof verified.value === "object" &&
      verified.value !== null &&
      "access_token" in verified.value &&
      typeof verified.value.access_token === "string"
        ? verified.value.access_token
        : null;
    expect(recipientToken).toBeTruthy();

    const accepted = await requestJson(
      `${apiUrl}/rest/v1/rpc/accept_invitation`,
      publishableKey,
      {
        body: JSON.stringify({ token: invitationToken }),
        headers: { authorization: `Bearer ${recipientToken}` },
        method: "POST",
      },
    );
    expect(accepted.response.ok).toBe(true);
    expect(accepted.value).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/u));

    const replay = await requestJson(
      `${apiUrl}/rest/v1/rpc/accept_invitation`,
      publishableKey,
      {
        body: JSON.stringify({ token: invitationToken }),
        headers: { authorization: `Bearer ${recipientToken}` },
        method: "POST",
      },
    );
    expect(replay.response.ok).toBe(true);
    expect(replay.value).toBeNull();

    queryDatabase(`
      do $assert_phase_2d$
      begin
        if not exists (
          select 1 from private.invitation_email_requests
           where id = '${requestId}'::uuid
             and state = 'accepted'
             and normalized_email is null
             and accepted_at is not null
        ) or not exists (
          select 1 from private.invitation_delivery_receipts
           where invitation_job_id = '${provisioned.jobId}'::uuid
             and octet_length(payload_sha256) = 32
             and octet_length(token_sha256) = 32
        ) or (select count(*) from public.circle_memberships
               where circle_id = '${CIRCLE_A}'::uuid
                 and user_id = (
                   select target_auth_user_id
                     from private.invitation_email_requests
                    where id = '${requestId}'::uuid
                 ) and status = 'active') <> 1
        then
          raise exception 'Phase 2D durable acceptance invariant failed';
        end if;
      end
      $assert_phase_2d$;
    `);
  }, 120_000);
});
