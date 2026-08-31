import { describe, expect, it, vi } from "vitest";
import {
  InvitationCoordinatorAdapterError,
  SupabaseInvitationDeliveryCoordinator,
  SupabaseInvitationProvisioningCoordinator,
} from "./supabase-coordinator-adapter";

const ids = {
  request: "a3000000-0000-4000-8000-000000000001",
  job: "a3000000-0000-4000-8000-000000000002",
  invitation: "a3000000-0000-4000-8000-000000000003",
  receipt: "a3000000-0000-4000-8000-000000000004",
  worker: "a3000000-0000-4000-8000-000000000005",
  requestKey: "a3000000-0000-4000-8000-000000000006",
  session: "a3000000-0000-4000-8000-000000000007",
  circle: "20000000-0000-4000-8000-000000000001",
  requester: "40000000-0000-4000-8000-000000000001",
  target: "b3000000-0000-4000-8000-000000000001",
} as const;
const publishableKey = "local-publishable-key-1234567890";
const workerAccessToken = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  ),
  Buffer.from(
    JSON.stringify({
      exp: 4_102_444_800,
      role: "authenticated",
      session_id: ids.session,
      sub: ids.worker,
    }),
  ).toString("base64url"),
  "local-test-signature",
].join(".");
const authorizationVersion = "2026-08-31T12:00:00.123456-07:00";
const tokenSha256 = "a".repeat(64);
const payloadSha256 = "b".repeat(64);
const recipientBinding = "c".repeat(64);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function rpcName(input: RequestInfo | URL) {
  return new URL(String(input)).pathname.split("/").at(-1) ?? "";
}

function body(init?: RequestInit) {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function connection(fetch: typeof globalThis.fetch) {
  return {
    projectUrl: "http://127.0.0.1:54321",
    publishableKey,
    workerAccessToken,
    fetch,
  };
}

const emailRequestRow = {
  email_request_id: ids.request,
  circle_id: ids.circle,
  requester_membership_id: ids.requester,
  requester_authorization_version: authorizationVersion,
  normalized_email: "new.relative@example.test",
  invited_display_name: "A Relative",
  state: "queued",
  invitation_job_id: null,
  requested_at: "2026-08-31T19:00:00+00:00",
  expires_at: "2026-09-02T19:00:00+00:00",
} as const;

const deliveryJobRow = {
  invitation_job_id: ids.job,
  email_request_id: ids.request,
  circle_id: ids.circle,
  requester_membership_id: ids.requester,
  requester_authorization_version: authorizationVersion,
  target_auth_user_id: ids.target,
  invited_display_name: "A Relative",
  request_key: ids.requestKey,
  state: "queued",
  token_key_version: 1,
  delivery_version: 1,
  requested_at: "2026-08-31T19:00:00+00:00",
  expires_at: "2026-09-02T19:00:00+00:00",
} as const;

const receiptRow = {
  receipt_id: ids.receipt,
  circle_id: ids.circle,
  email_request_id: ids.request,
  invitation_job_id: ids.job,
  invitation_id: ids.invitation,
  delivery_version: 1,
  delivery_worker_auth_user_id: ids.worker,
  provider: "mail-test",
  provider_message_id: "message-1",
  provider_idempotency_key:
    "our-days/invitation-delivery/v1:a3000000-0000-4000-8000-000000000002:1",
  token_sha256_hex: tokenSha256,
  payload_sha256_hex: payloadSha256,
  recipient_binding_hex: recipientBinding,
  provider_accepted_at: "2026-08-31T19:00:02+00:00",
  recorded_at: "2026-08-31T19:00:03+00:00",
} as const;

describe("Supabase invitation provisioning coordinator", () => {
  it("maps one private request while preserving opaque authorization text", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json([emailRequestRow]),
    );
    const coordinator = new SupabaseInvitationProvisioningCoordinator(
      connection(fetch),
    );
    await expect(
      coordinator.loadAuthorizedRequest(ids.request),
    ).resolves.toEqual({
      requestId: ids.request,
      circleId: ids.circle,
      requesterMembershipId: ids.requester,
      authorizationVersion,
      normalizedEmail: "new.relative@example.test",
      displayName: "A Relative",
      state: "queued",
      requestedAt: "2026-08-31T19:00:00.000Z",
    });
    expect(body(fetch.mock.calls[0]?.[1])).toEqual({
      email_request_id: ids.request,
    });
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({
      apikey: publishableKey,
      authorization: `Bearer ${workerAccessToken}`,
      "content-type": "application/json",
    });
  });

  it("completes and then freshly compares the same provisioned job", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      switch (rpcName(input)) {
        case "complete_invitation_email_provisioning":
          return json([
            {
              email_request_id: ids.request,
              invitation_job_id: ids.job,
              target_auth_user_id: ids.target,
              target_email_confirmed: false,
              expires_at: emailRequestRow.expires_at,
            },
          ]);
        case "load_invitation_email_request":
          return json([
            {
              ...emailRequestRow,
              state: "provisioned",
              invitation_job_id: ids.job,
            },
          ]);
        default:
          return json({}, 404);
      }
    });
    const coordinator = new SupabaseInvitationProvisioningCoordinator(
      connection(fetch),
    );
    await expect(
      coordinator.completeProvisioningAtomically({
        requestId: ids.request,
        circleId: ids.circle,
        requesterMembershipId: ids.requester,
        authorizationVersion,
        targetAuthUserId: ids.target,
      }),
    ).resolves.toEqual({
      requestId: ids.request,
      jobId: ids.job,
      state: "provisioned",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails closed if a post-completion authorization identity drifts", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      rpcName(input) === "complete_invitation_email_provisioning"
        ? json([
            {
              email_request_id: ids.request,
              invitation_job_id: ids.job,
              target_auth_user_id: ids.target,
              target_email_confirmed: false,
              expires_at: emailRequestRow.expires_at,
            },
          ])
        : json([
            {
              ...emailRequestRow,
              requester_authorization_version: "2026-08-31T19:01:00+00:00",
              state: "provisioned",
              invitation_job_id: ids.job,
            },
          ]),
    );
    const coordinator = new SupabaseInvitationProvisioningCoordinator(
      connection(fetch),
    );
    await expect(
      coordinator.completeProvisioningAtomically({
        requestId: ids.request,
        circleId: ids.circle,
        requesterMembershipId: ids.requester,
        authorizationVersion,
        targetAuthUserId: ids.target,
      }),
    ).rejects.toBeInstanceOf(InvitationCoordinatorAdapterError);
  });
});

describe("Supabase invitation delivery coordinator", () => {
  it("runs only a bounded expiry scrub through the delivery-worker RPC", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(3));
    const coordinator = new SupabaseInvitationDeliveryCoordinator(
      connection(fetch),
    );

    await expect(coordinator.sweepExpiredRequests(25)).resolves.toBe(3);
    expect(rpcName(fetch.mock.calls[0]?.[0] ?? "")).toBe(
      "sweep_expired_invitation_email_requests",
    );
    expect(body(fetch.mock.calls[0]?.[1])).toEqual({ batch_limit: 25 });
  });

  it.each([0, 101, 1.5, Number.NaN])(
    "rejects an unsafe expiry batch %s before fetch",
    async (maximum) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const coordinator = new SupabaseInvitationDeliveryCoordinator(
        connection(fetch),
      );
      await expect(
        coordinator.sweepExpiredRequests(maximum),
      ).rejects.toBeInstanceOf(InvitationCoordinatorAdapterError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("maps the complete immutable delivery job identity", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json([deliveryJobRow]),
    );
    const coordinator = new SupabaseInvitationDeliveryCoordinator(
      connection(fetch),
    );
    await expect(coordinator.loadAuthorizedJob(ids.job)).resolves.toEqual({
      jobId: ids.job,
      circleId: ids.circle,
      requesterMembershipId: ids.requester,
      authorizationVersion,
      targetAuthUserId: ids.target,
      displayName: "A Relative",
      state: "queued",
      keyVersion: 1,
      deliveryVersion: 1,
      requestedAt: "2026-08-31T19:00:00.000Z",
    });
  });

  it("maps one locked unconfirmed recipient snapshot", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json([
        {
          invitation_job_id: ids.job,
          invitation_id: ids.invitation,
          delivery_version: 1,
          token_sha256_hex: tokenSha256,
          target_auth_user_id: ids.target,
          normalized_email: "new.relative@example.test",
          email_confirmed_at: null,
          recipient_binding_hex: recipientBinding,
        },
      ]),
    );
    const coordinator = new SupabaseInvitationDeliveryCoordinator(
      connection(fetch),
    );
    await expect(
      coordinator.readDeliveryAuthorizationAtomically({
        jobId: ids.job,
        circleId: ids.circle,
        requesterMembershipId: ids.requester,
        authorizationVersion,
        targetAuthUserId: ids.target,
        deliveryVersion: 1,
        tokenSha256,
        invitationId: ids.invitation,
      }),
    ).resolves.toEqual({
      invitationId: ids.invitation,
      deliveryVersion: 1,
      tokenSha256,
      recipient: {
        email: "new.relative@example.test",
        confirmedAt: null,
      },
      recipientBinding,
    });
  });

  it("completes only after a fresh full receipt comparison", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      switch (rpcName(input)) {
        case "complete_invitation_delivery":
          return json(ids.receipt);
        case "read_delivered_invitation":
          return json([receiptRow]);
        default:
          return json({}, 404);
      }
    });
    const coordinator = new SupabaseInvitationDeliveryCoordinator(
      connection(fetch),
    );
    const providerReceipt = {
      provider: receiptRow.provider,
      messageId: receiptRow.provider_message_id,
      idempotencyKey: receiptRow.provider_idempotency_key,
      payloadSha256,
      acceptedAt: "2026-08-31T19:00:02.000Z",
    };
    await expect(
      coordinator.completeDeliveryAtomically({
        jobId: ids.job,
        circleId: ids.circle,
        requesterMembershipId: ids.requester,
        authorizationVersion,
        targetAuthUserId: ids.target,
        deliveryVersion: 1,
        tokenSha256,
        invitationId: ids.invitation,
        recipientBinding,
        providerReceipt,
      }),
    ).resolves.toEqual(providerReceipt);
    expect(body(fetch.mock.calls[0]?.[1])).toEqual({
      invitation_job_id: ids.job,
      invitation_id: ids.invitation,
      delivery_version: 1,
      token_sha256_hex: tokenSha256,
      recipient_binding_hex: recipientBinding,
      provider: receiptRow.provider,
      provider_message_id: receiptRow.provider_message_id,
      provider_idempotency_key: receiptRow.provider_idempotency_key,
      payload_sha256_hex: payloadSha256,
      provider_accepted_at: "2026-08-31T19:00:02.000Z",
    });
  });

  it("rejects a mismatched durable payload checksum after completion", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      rpcName(input) === "complete_invitation_delivery"
        ? json(ids.receipt)
        : json([{ ...receiptRow, payload_sha256_hex: "d".repeat(64) }]),
    );
    const coordinator = new SupabaseInvitationDeliveryCoordinator(
      connection(fetch),
    );
    await expect(
      coordinator.completeDeliveryAtomically({
        jobId: ids.job,
        circleId: ids.circle,
        requesterMembershipId: ids.requester,
        authorizationVersion,
        targetAuthUserId: ids.target,
        deliveryVersion: 1,
        tokenSha256,
        invitationId: ids.invitation,
        recipientBinding,
        providerReceipt: {
          provider: receiptRow.provider,
          messageId: receiptRow.provider_message_id,
          idempotencyKey: receiptRow.provider_idempotency_key,
          payloadSha256,
          acceptedAt: "2026-08-31T19:00:02.000Z",
        },
      }),
    ).rejects.toBeInstanceOf(InvitationCoordinatorAdapterError);
  });

  it("maps denials and hostile response bodies to one content-free error", async () => {
    const privateEmail = "private.relative@example.test";
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({ message: privateEmail }, 403),
    );
    const coordinator = new SupabaseInvitationDeliveryCoordinator(
      connection(fetch),
    );
    const error = await coordinator
      .loadAuthorizedJob(ids.job)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvitationCoordinatorAdapterError);
    expect(String(error)).not.toContain(privateEmail);
  });

  it.each([
    [
      "service role",
      {
        exp: 4_102_444_800,
        role: "service_role",
        session_id: ids.session,
        sub: ids.worker,
      },
    ],
    [
      "anonymous",
      {
        exp: 4_102_444_800,
        role: "anon",
        session_id: ids.session,
        sub: ids.worker,
      },
    ],
    [
      "expired",
      {
        exp: 1,
        role: "authenticated",
        session_id: ids.session,
        sub: ids.worker,
      },
    ],
    [
      "sessionless",
      { exp: 4_102_444_800, role: "authenticated", sub: ids.worker },
    ],
    ["missing subject", { exp: 4_102_444_800, role: "authenticated" }],
  ])("rejects a %s database token before any request", (_label, payload) => {
    const token = [
      "e30",
      Buffer.from(JSON.stringify(payload)).toString("base64url"),
      "signature",
    ].join(".");
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(
      () =>
        new SupabaseInvitationDeliveryCoordinator({
          ...connection(fetch),
          workerAccessToken: token,
        }),
    ).toThrow(InvitationCoordinatorAdapterError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
