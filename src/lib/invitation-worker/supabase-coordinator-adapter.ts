import type {
  InvitationCompletionInput,
  InvitationDeliveryAuthorization,
  InvitationJobCoordinator,
  InvitationJobIdentity,
  InvitationLedgerJob,
  InvitationMaterialization,
  InvitationMaterializationInput,
  InvitationProviderReceipt,
} from "./contract";
import type {
  InvitationProvisioningCompletionInput,
  InvitationProvisioningCoordinator,
  InvitationProvisioningIdentity,
  InvitationProvisioningRequest,
  InvitationProvisioningResult,
} from "./provisioner";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
type Fetch = typeof globalThis.fetch;

export class InvitationCoordinatorAdapterError extends Error {
  constructor() {
    super("Invitation coordination failed.");
    this.name = "InvitationCoordinatorAdapterError";
  }
}

function failed(): never {
  throw new InvitationCoordinatorAdapterError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) failed();
  return value;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) failed();
  return Number(value);
}

function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL_CHARACTER.test(value)
  )
    failed();
  return value;
}

function sha256(value: unknown): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) failed();
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || value.length < 20 || value.length > 35)
    failed();
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) failed();
  return date.toISOString();
}

function opaqueTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.length < 20 || value.length > 35)
    failed();
  return value;
}

function normalizedEmail(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 254 ||
    value !== value.trim().toLowerCase() ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) ||
    CONTROL_CHARACTER.test(value)
  )
    failed();
  return value;
}

function validateProjectOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    failed();
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    failed();
  return url.origin;
}

function validateAuthenticatedWorkerJwt(value: string) {
  const segments = value.split(".");
  if (segments.length !== 3) failed();
  let payload: unknown;
  try {
    payload = JSON.parse(
      Buffer.from(segments[1] ?? "", "base64url").toString(),
    );
  } catch {
    failed();
  }
  if (
    !isRecord(payload) ||
    payload.role !== "authenticated" ||
    typeof payload.sub !== "string" ||
    !UUID_V4.test(payload.sub) ||
    typeof payload.session_id !== "string" ||
    !UUID_V4.test(payload.session_id) ||
    !Number.isSafeInteger(payload.exp) ||
    Number(payload.exp) <= Math.floor(Date.now() / 1_000)
  )
    failed();
}

class SupabaseWorkerRpc {
  readonly #origin: string;
  readonly #publishableKey: string;
  readonly #workerAccessToken: string;
  readonly #fetch: Fetch;

  constructor(input: {
    projectUrl: string;
    publishableKey: string;
    workerAccessToken: string;
    fetch?: Fetch;
  }) {
    this.#origin = validateProjectOrigin(input.projectUrl);
    for (const credential of [input.publishableKey, input.workerAccessToken]) {
      if (
        typeof credential !== "string" ||
        credential.length < 20 ||
        CONTROL_CHARACTER.test(credential)
      )
        failed();
    }
    validateAuthenticatedWorkerJwt(input.workerAccessToken);
    this.#publishableKey = input.publishableKey;
    this.#workerAccessToken = input.workerAccessToken;
    this.#fetch = input.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") failed();
  }

  async call(name: string, body: Readonly<Record<string, unknown>>) {
    const response = await this.#fetch(
      `${this.#origin}/rest/v1/rpc/${encodeURIComponent(name)}`,
      {
        body: JSON.stringify(body),
        headers: {
          apikey: this.#publishableKey,
          authorization: `Bearer ${this.#workerAccessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    ).catch(failed);
    if (!response.ok) failed();
    return response.json().catch(failed) as Promise<unknown>;
  }
}

function optionalSingleRow(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length > 1) failed();
  if (value.length === 0) return null;
  if (!isRecord(value[0])) failed();
  return value[0];
}

function singleRow(value: unknown): Record<string, unknown> {
  const row = optionalSingleRow(value);
  if (!row) failed();
  return row;
}

type CoordinatorConnection = ConstructorParameters<typeof SupabaseWorkerRpc>[0];

export class SupabaseInvitationProvisioningCoordinator implements InvitationProvisioningCoordinator {
  readonly #rpc: SupabaseWorkerRpc;

  constructor(input: CoordinatorConnection) {
    this.#rpc = new SupabaseWorkerRpc(input);
  }

  async loadAuthorizedRequest(
    requestId: string,
  ): Promise<InvitationProvisioningRequest | null> {
    const row = optionalSingleRow(
      await this.#rpc.call("load_invitation_email_request", {
        email_request_id: requestId,
      }),
    );
    if (!row) return null;
    if (
      !hasExactKeys(row, [
        "email_request_id",
        "circle_id",
        "requester_membership_id",
        "requester_authorization_version",
        "normalized_email",
        "invited_display_name",
        "state",
        "invitation_job_id",
        "requested_at",
        "expires_at",
      ]) ||
      row.email_request_id !== requestId ||
      !["queued", "provisioned"].includes(String(row.state)) ||
      (row.state === "queued" && row.invitation_job_id !== null) ||
      (row.state === "provisioned" &&
        (typeof row.invitation_job_id !== "string" ||
          !UUID_V4.test(row.invitation_job_id)))
    )
      failed();
    timestamp(row.expires_at);
    return {
      requestId: uuid(row.email_request_id),
      circleId: uuid(row.circle_id),
      requesterMembershipId: uuid(row.requester_membership_id),
      authorizationVersion: opaqueTimestamp(
        row.requester_authorization_version,
      ),
      normalizedEmail: normalizedEmail(row.normalized_email),
      displayName: text(row.invited_display_name, 80),
      state: row.state as "queued" | "provisioned",
      requestedAt: timestamp(row.requested_at),
    };
  }

  async #readProvisioned(
    input: InvitationProvisioningIdentity,
  ): Promise<InvitationProvisioningResult | null> {
    const row = optionalSingleRow(
      await this.#rpc.call("load_invitation_email_request", {
        email_request_id: input.requestId,
      }),
    );
    if (!row) return null;
    if (
      row.email_request_id !== input.requestId ||
      row.circle_id !== input.circleId ||
      row.requester_membership_id !== input.requesterMembershipId ||
      row.requester_authorization_version !== input.authorizationVersion ||
      row.state !== "provisioned"
    )
      failed();
    return {
      requestId: input.requestId,
      jobId: uuid(row.invitation_job_id),
      state: "provisioned",
    };
  }

  readProvisionedIfAuthorized(input: InvitationProvisioningIdentity) {
    return this.#readProvisioned(input);
  }

  async completeProvisioningAtomically(
    input: InvitationProvisioningCompletionInput,
  ): Promise<InvitationProvisioningResult> {
    const row = singleRow(
      await this.#rpc.call("complete_invitation_email_provisioning", {
        email_request_id: input.requestId,
        target_auth_user_id: input.targetAuthUserId,
      }),
    );
    if (
      !hasExactKeys(row, [
        "email_request_id",
        "invitation_job_id",
        "target_auth_user_id",
        "target_email_confirmed",
        "expires_at",
      ]) ||
      row.email_request_id !== input.requestId ||
      row.target_auth_user_id !== input.targetAuthUserId ||
      typeof row.target_email_confirmed !== "boolean"
    )
      failed();
    timestamp(row.expires_at);
    const result = {
      requestId: input.requestId,
      jobId: uuid(row.invitation_job_id),
      state: "provisioned" as const,
    };
    const reauthorized = await this.#readProvisioned(input);
    if (!reauthorized || reauthorized.jobId !== result.jobId) failed();
    return result;
  }
}

export class SupabaseInvitationDeliveryCoordinator implements InvitationJobCoordinator {
  readonly #rpc: SupabaseWorkerRpc;

  constructor(input: CoordinatorConnection) {
    this.#rpc = new SupabaseWorkerRpc(input);
  }

  /**
   * Periodic worker maintenance. The database reauthorizes the live delivery
   * session and bounds the batch before scrubbing expired recipient addresses.
   */
  async sweepExpiredRequests(maximum: number): Promise<number> {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 100)
      failed();
    const value = await this.#rpc.call(
      "sweep_expired_invitation_email_requests",
      { batch_limit: maximum },
    );
    if (
      !Number.isSafeInteger(value) ||
      Number(value) < 0 ||
      Number(value) > maximum
    )
      failed();
    return Number(value);
  }

  async loadAuthorizedJob(jobId: string): Promise<InvitationLedgerJob | null> {
    const row = optionalSingleRow(
      await this.#rpc.call("load_invitation_delivery_job", {
        invitation_job_id: jobId,
      }),
    );
    if (!row) return null;
    if (
      !hasExactKeys(row, [
        "invitation_job_id",
        "email_request_id",
        "circle_id",
        "requester_membership_id",
        "requester_authorization_version",
        "target_auth_user_id",
        "invited_display_name",
        "request_key",
        "state",
        "token_key_version",
        "delivery_version",
        "requested_at",
        "expires_at",
      ]) ||
      row.invitation_job_id !== jobId ||
      !["queued", "materialized", "delivered"].includes(String(row.state))
    )
      failed();
    uuid(row.email_request_id);
    uuid(row.request_key);
    timestamp(row.expires_at);
    return {
      jobId: uuid(row.invitation_job_id),
      circleId: uuid(row.circle_id),
      requesterMembershipId: uuid(row.requester_membership_id),
      authorizationVersion: opaqueTimestamp(
        row.requester_authorization_version,
      ),
      targetAuthUserId: uuid(row.target_auth_user_id),
      displayName: text(row.invited_display_name, 80),
      state: row.state as "queued" | "materialized" | "delivered",
      keyVersion: integer(row.token_key_version),
      deliveryVersion: integer(row.delivery_version),
      requestedAt: timestamp(row.requested_at),
    };
  }

  async materializeInvitationAtomically(
    input: InvitationMaterializationInput,
  ): Promise<InvitationMaterialization> {
    const row = singleRow(
      await this.#rpc.call("materialize_invitation_delivery_job", {
        invitation_job_id: input.jobId,
        delivery_version: input.deliveryVersion,
        token_sha256_hex: input.tokenSha256,
      }),
    );
    if (
      !hasExactKeys(row, [
        "invitation_job_id",
        "invitation_id",
        "state",
        "delivery_version",
        "expires_at",
      ]) ||
      row.invitation_job_id !== input.jobId ||
      !["materialized", "delivered"].includes(String(row.state)) ||
      row.delivery_version !== input.deliveryVersion
    )
      failed();
    timestamp(row.expires_at);
    return {
      invitationId: uuid(row.invitation_id),
      tokenSha256: sha256(input.tokenSha256),
      deliveryVersion: integer(row.delivery_version),
    };
  }

  async readDeliveryAuthorizationAtomically(
    input: InvitationMaterializationInput & Readonly<{ invitationId: string }>,
  ): Promise<InvitationDeliveryAuthorization> {
    const row = singleRow(
      await this.#rpc.call("read_invitation_delivery_auth", {
        invitation_job_id: input.jobId,
      }),
    );
    if (
      !hasExactKeys(row, [
        "invitation_job_id",
        "invitation_id",
        "delivery_version",
        "token_sha256_hex",
        "target_auth_user_id",
        "normalized_email",
        "email_confirmed_at",
        "recipient_binding_hex",
      ]) ||
      row.invitation_job_id !== input.jobId ||
      row.invitation_id !== input.invitationId ||
      row.delivery_version !== input.deliveryVersion ||
      row.token_sha256_hex !== input.tokenSha256 ||
      row.target_auth_user_id !== input.targetAuthUserId ||
      (row.email_confirmed_at !== null &&
        typeof row.email_confirmed_at !== "string")
    )
      failed();
    return {
      invitationId: uuid(row.invitation_id),
      tokenSha256: sha256(row.token_sha256_hex),
      deliveryVersion: integer(row.delivery_version),
      recipient: {
        email: normalizedEmail(row.normalized_email),
        confirmedAt:
          row.email_confirmed_at === null
            ? null
            : opaqueTimestamp(row.email_confirmed_at),
      },
      recipientBinding: sha256(row.recipient_binding_hex),
    };
  }

  async #readDelivered(input: InvitationJobIdentity): Promise<
    | (InvitationProviderReceipt &
        Readonly<{
          invitationId: string;
          tokenSha256: string;
          binding: string;
        }>)
    | null
  > {
    const row = optionalSingleRow(
      await this.#rpc.call("read_delivered_invitation", {
        invitation_job_id: input.jobId,
      }),
    );
    if (!row) return null;
    if (
      !hasExactKeys(row, [
        "receipt_id",
        "circle_id",
        "email_request_id",
        "invitation_job_id",
        "invitation_id",
        "delivery_version",
        "delivery_worker_auth_user_id",
        "provider",
        "provider_message_id",
        "provider_idempotency_key",
        "token_sha256_hex",
        "payload_sha256_hex",
        "recipient_binding_hex",
        "provider_accepted_at",
        "recorded_at",
      ]) ||
      row.invitation_job_id !== input.jobId ||
      row.circle_id !== input.circleId ||
      row.delivery_version !== input.deliveryVersion
    )
      failed();
    uuid(row.receipt_id);
    uuid(row.email_request_id);
    uuid(row.delivery_worker_auth_user_id);
    timestamp(row.recorded_at);
    return {
      provider: text(row.provider, 64),
      messageId: text(row.provider_message_id, 200),
      idempotencyKey: text(row.provider_idempotency_key, 300),
      payloadSha256: sha256(row.payload_sha256_hex),
      acceptedAt: timestamp(row.provider_accepted_at),
      invitationId: uuid(row.invitation_id),
      tokenSha256: sha256(row.token_sha256_hex),
      binding: sha256(row.recipient_binding_hex),
    };
  }

  async completeDeliveryAtomically(
    input: InvitationCompletionInput,
  ): Promise<InvitationProviderReceipt> {
    const value = await this.#rpc.call("complete_invitation_delivery", {
      invitation_job_id: input.jobId,
      invitation_id: input.invitationId,
      delivery_version: input.deliveryVersion,
      token_sha256_hex: input.tokenSha256,
      recipient_binding_hex: input.recipientBinding,
      provider: input.providerReceipt.provider,
      provider_message_id: input.providerReceipt.messageId,
      provider_idempotency_key: input.providerReceipt.idempotencyKey,
      payload_sha256_hex: input.providerReceipt.payloadSha256,
      provider_accepted_at: input.providerReceipt.acceptedAt,
    });
    if (typeof value !== "string" || !UUID_V4.test(value)) failed();
    const stored = await this.#readDelivered(input);
    if (
      !stored ||
      stored.invitationId !== input.invitationId ||
      stored.tokenSha256 !== input.tokenSha256 ||
      stored.binding !== input.recipientBinding ||
      stored.provider !== input.providerReceipt.provider ||
      stored.messageId !== input.providerReceipt.messageId ||
      stored.idempotencyKey !== input.providerReceipt.idempotencyKey ||
      stored.payloadSha256 !== input.providerReceipt.payloadSha256 ||
      stored.acceptedAt !== timestamp(input.providerReceipt.acceptedAt)
    )
      failed();
    return {
      provider: stored.provider,
      messageId: stored.messageId,
      idempotencyKey: stored.idempotencyKey,
      payloadSha256: stored.payloadSha256,
      acceptedAt: stored.acceptedAt,
    };
  }

  async readDeliveredIfAuthorized(
    input: InvitationJobIdentity,
  ): Promise<InvitationProviderReceipt | null> {
    const stored = await this.#readDelivered(input);
    if (!stored) return null;
    return {
      provider: stored.provider,
      messageId: stored.messageId,
      idempotencyKey: stored.idempotencyKey,
      payloadSha256: stored.payloadSha256,
      acceptedAt: stored.acceptedAt,
    };
  }
}
