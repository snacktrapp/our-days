import { createHash, createHmac } from "node:crypto";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const PROVIDER = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const TOKEN_DOMAIN = "our-days/invitation-token/v1";
const DELIVERY_DOMAIN = "our-days/invitation-delivery/v1";

export type InvitationJobState =
  "queued" | "materialized" | "delivered" | "invalidated";

/**
 * Immutable values loaded from the durable invitation ledger. Production
 * adapters must not add a recipient email, raw invitation token, or action URL
 * to this record.
 */
export type InvitationLedgerJob = Readonly<{
  jobId: string;
  circleId: string;
  requesterMembershipId: string;
  authorizationVersion: string;
  targetAuthUserId: string;
  displayName: string;
  state: InvitationJobState;
  keyVersion: number;
  deliveryVersion: number;
  requestedAt: string;
}>;

export type InvitationDeliveryRecipient = Readonly<{
  email: string;
  /** Null only for an exact account provisioned unconfirmed for this invite. */
  confirmedAt: string | null;
}>;

/** @deprecated Prefer InvitationDeliveryRecipient for the Phase 2D flow. */
export type ConfirmedInvitationRecipient = InvitationDeliveryRecipient;

/**
 * Opaque identity/version for the confirmed recipient snapshot. It must change
 * whenever the address or confirmation authority changes. Workers preserve it
 * byte-for-byte; only the authoritative coordinator interprets it.
 */
export type InvitationRecipientBinding = string;

export type InvitationMaterialization = Readonly<{
  invitationId: string;
  tokenSha256: string;
  deliveryVersion: number;
}>;

/** The full provider receipt is durable worker state and is never returned publicly. */
export type InvitationProviderReceipt = Readonly<{
  provider: string;
  messageId: string;
  acceptedAt: string;
  idempotencyKey: string;
  /** SHA-256 of the exact provider payload/body accepted for delivery. */
  payloadSha256: string;
}>;

export type InvitationWorkerResult = Readonly<{
  jobId: string;
  state: "delivered";
  deliveryVersion: number;
}>;

export type InvitationJobIdentity = Readonly<{
  jobId: string;
  circleId: string;
  requesterMembershipId: string;
  authorizationVersion: string;
  targetAuthUserId: string;
  deliveryVersion: number;
}>;

export type InvitationMaterializationInput = InvitationJobIdentity &
  Readonly<{ tokenSha256: string }>;

export type InvitationCompletionInput = InvitationMaterializationInput &
  Readonly<{
    invitationId: string;
    recipientBinding: InvitationRecipientBinding;
    providerReceipt: InvitationProviderReceipt;
  }>;

export type InvitationDeliveryAuthorization = InvitationMaterialization &
  Readonly<{
    recipient: InvitationDeliveryRecipient;
    recipientBinding: InvitationRecipientBinding;
  }>;

/**
 * Production implementations belong behind a separately deployed privileged
 * worker. Every method named `Authorized` or `Atomically` must lock/reload the
 * durable job, freshly verify its recorded requester membership generation,
 * and verify that the target is not already active in the same circle. Once an
 * invitation has been materialized, loss of requester authority, recipient
 * confirmation/binding, or target eligibility must atomically invalidate both
 * the job and invitation before failing.
 */
export interface InvitationJobCoordinator {
  loadAuthorizedJob(jobId: string): Promise<InvitationLedgerJob | null>;

  materializeInvitationAtomically(
    input: InvitationMaterializationInput,
  ): Promise<InvitationMaterialization>;

  /**
   * Fresh atomic authorization immediately before an external side effect.
   * The confirmed normalized recipient and opaque binding must come from the
   * same authoritative snapshot as the job/invitation authorization checks.
   */
  readDeliveryAuthorizationAtomically(
    input: InvitationMaterializationInput & Readonly<{ invitationId: string }>,
  ): Promise<InvitationDeliveryAuthorization>;

  /**
   * In one atomic operation: reauthorize the immutable requester generation,
   * compare the complete job identity, verify that the invitation is still
   * live and matches the digest, recheck the exact recipient binding returned
   * by `readDeliveryAuthorizationAtomically`, then insert-or-compare every
   * provider receipt field. A stale separate authorization check is
   * insufficient.
   */
  completeDeliveryAtomically(
    input: InvitationCompletionInput,
  ): Promise<InvitationProviderReceipt>;

  /** Existing delivered results must never bypass a fresh authorization check. */
  readDeliveredIfAuthorized(
    input: InvitationJobIdentity,
  ): Promise<InvitationProviderReceipt | null>;
}

export interface InvitationTokenKeyring {
  /** Worker-only key material. The durable job records only its numeric version. */
  readKey(keyVersion: number): Promise<Uint8Array | null>;
}

export type InvitationDeliveryInput = Readonly<{
  jobId: string;
  deliveryVersion: number;
  idempotencyKey: string;
  displayName: string;
  recipientEmail: string;
  invitationToken: string;
}>;

export interface InvitationDeliveryProvider {
  /**
   * Production adapters construct the approved application URL themselves and
   * must make this idempotency key durable at the provider boundary.
   */
  deliver(input: InvitationDeliveryInput): Promise<InvitationProviderReceipt>;
}

export type InvitationWorkerProgress = Readonly<{
  stage:
    | "after-materialization"
    | "before-provider"
    | "after-provider"
    | "after-completion";
}>;

export type InvitationWorkerFaultInjector = (
  progress: InvitationWorkerProgress,
) => void | Promise<void>;

export type InvitationWorkerRuntime = Readonly<{
  /** Omitted and false both fail closed before any dependency is touched. */
  enabled?: boolean;
  coordinator: InvitationJobCoordinator;
  keyring: InvitationTokenKeyring;
  provider: InvitationDeliveryProvider;
  injectFault?: InvitationWorkerFaultInjector;
}>;

export class InvitationWorkerError extends Error {
  readonly code: "INVITATION_DELIVERY_DISABLED" | "INVITATION_DELIVERY_FAILED";

  constructor(
    code: "INVITATION_DELIVERY_DISABLED" | "INVITATION_DELIVERY_FAILED",
  ) {
    super(
      code === "INVITATION_DELIVERY_DISABLED"
        ? "Invitation delivery is disabled."
        : "Invitation delivery could not be completed.",
    );
    this.name = "InvitationWorkerError";
    this.code = code;
  }
}

function disabled(): never {
  throw new InvitationWorkerError("INVITATION_DELIVERY_DISABLED");
}

function failed(): never {
  throw new InvitationWorkerError("INVITATION_DELIVERY_FAILED");
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

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u;

/**
 * Validate without parsing or normalizing. Authorization versions are opaque
 * database compare values, so offsets and microseconds must survive exactly.
 */
function isBoundedRfc3339Timestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20 || value.length > 32)
    return false;
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) return false;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    zone,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  if (daysInMonth === undefined || day < 1 || day > daysInMonth) return false;
  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    )
      return false;
  }
  return true;
}

function isCanonicalUtc(value: unknown): value is string {
  return (
    isBoundedRfc3339Timestamp(value) &&
    value.endsWith("Z") &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  );
}

function isVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function validateJob(value: unknown): InvitationLedgerJob {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "jobId",
      "circleId",
      "requesterMembershipId",
      "authorizationVersion",
      "targetAuthUserId",
      "displayName",
      "state",
      "keyVersion",
      "deliveryVersion",
      "requestedAt",
    ]) ||
    !isCanonicalUuid(value.jobId) ||
    !isCanonicalUuid(value.circleId) ||
    !isCanonicalUuid(value.requesterMembershipId) ||
    !isCanonicalUuid(value.targetAuthUserId) ||
    !isBoundedRfc3339Timestamp(value.authorizationVersion) ||
    !isCanonicalUtc(value.requestedAt) ||
    typeof value.displayName !== "string" ||
    value.displayName !== value.displayName.trim() ||
    Array.from(value.displayName).length < 1 ||
    Array.from(value.displayName).length > 80 ||
    CONTROL_CHARACTER.test(value.displayName) ||
    !["queued", "materialized", "delivered", "invalidated"].includes(
      String(value.state),
    ) ||
    !isVersion(value.keyVersion) ||
    !isVersion(value.deliveryVersion)
  )
    failed();
  return value as InvitationLedgerJob;
}

function validateRecipient(value: unknown): InvitationDeliveryRecipient {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["email", "confirmedAt"]) ||
    typeof value.email !== "string" ||
    value.email.length < 3 ||
    value.email.length > 254 ||
    value.email !== value.email.trim().toLowerCase() ||
    !EMAIL.test(value.email) ||
    CONTROL_CHARACTER.test(value.email) ||
    (value.confirmedAt !== null &&
      !isBoundedRfc3339Timestamp(value.confirmedAt))
  )
    failed();
  return value as InvitationDeliveryRecipient;
}

function isOpaqueRecipientBinding(
  value: unknown,
): value is InvitationRecipientBinding {
  return (
    typeof value === "string" &&
    Array.from(value).length >= 1 &&
    Array.from(value).length <= 200 &&
    !CONTROL_CHARACTER.test(value)
  );
}

function validateMaterialization(
  value: unknown,
  expected: Readonly<{ tokenSha256: string; deliveryVersion: number }>,
): InvitationMaterialization {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["invitationId", "tokenSha256", "deliveryVersion"]) ||
    !isCanonicalUuid(value.invitationId) ||
    value.tokenSha256 !== expected.tokenSha256 ||
    value.deliveryVersion !== expected.deliveryVersion
  )
    failed();
  return value as InvitationMaterialization;
}

function validateDeliveryAuthorization(
  value: unknown,
  expected: Readonly<{ tokenSha256: string; deliveryVersion: number }>,
): InvitationDeliveryAuthorization {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "invitationId",
      "tokenSha256",
      "deliveryVersion",
      "recipient",
      "recipientBinding",
    ])
  )
    failed();
  const materialization = validateMaterialization(
    {
      invitationId: value.invitationId,
      tokenSha256: value.tokenSha256,
      deliveryVersion: value.deliveryVersion,
    },
    expected,
  );
  const recipient = validateRecipient(value.recipient);
  if (!isOpaqueRecipientBinding(value.recipientBinding)) failed();
  return {
    ...materialization,
    recipient,
    recipientBinding: value.recipientBinding,
  };
}

function validateReceipt(
  value: unknown,
  expectedIdempotencyKey: string,
): InvitationProviderReceipt {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "provider",
      "messageId",
      "acceptedAt",
      "idempotencyKey",
      "payloadSha256",
    ]) ||
    typeof value.provider !== "string" ||
    !PROVIDER.test(value.provider) ||
    typeof value.messageId !== "string" ||
    value.messageId.length < 1 ||
    value.messageId.length > 200 ||
    CONTROL_CHARACTER.test(value.messageId) ||
    !isCanonicalUtc(value.acceptedAt) ||
    value.idempotencyKey !== expectedIdempotencyKey ||
    typeof value.payloadSha256 !== "string" ||
    !SHA256_HEX.test(value.payloadSha256)
  )
    failed();
  return value as InvitationProviderReceipt;
}

export function invitationDeliveryIdempotencyKey(
  jobId: string,
  deliveryVersion: number,
) {
  if (!isCanonicalUuid(jobId) || !isVersion(deliveryVersion)) failed();
  return `${DELIVERY_DOMAIN}:${jobId}:${deliveryVersion}`;
}

/**
 * Deterministic, domain-separated 256-bit bearer secret. Only a separately
 * deployed worker may call this with real key material.
 */
export function deriveInvitationToken(
  jobId: string,
  keyVersion: number,
  key: Uint8Array,
) {
  if (
    !isCanonicalUuid(jobId) ||
    !isVersion(keyVersion) ||
    !(key instanceof Uint8Array) ||
    key.byteLength !== 32
  )
    failed();
  return createHmac("sha256", key)
    .update(`${TOKEN_DOMAIN}\0${keyVersion}\0${jobId}`, "utf8")
    .digest("base64url");
}

export function invitationTokenSha256(token: string) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(token))
    failed();
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function identity(job: InvitationLedgerJob): InvitationJobIdentity {
  return {
    jobId: job.jobId,
    circleId: job.circleId,
    requesterMembershipId: job.requesterMembershipId,
    authorizationVersion: job.authorizationVersion,
    targetAuthUserId: job.targetAuthUserId,
    deliveryVersion: job.deliveryVersion,
  };
}

function publicResult(job: InvitationLedgerJob): InvitationWorkerResult {
  return {
    jobId: job.jobId,
    state: "delivered",
    deliveryVersion: job.deliveryVersion,
  };
}

async function runEnabledInvitationWorker(
  jobId: string,
  runtime: InvitationWorkerRuntime,
): Promise<InvitationWorkerResult> {
  if (!isCanonicalUuid(jobId)) failed();
  const loaded = await runtime.coordinator.loadAuthorizedJob(jobId);
  if (!loaded) failed();
  const job = validateJob(loaded);
  if (job.jobId !== jobId || job.state === "invalidated") failed();

  const expectedIdentity = identity(job);
  const idempotencyKey = invitationDeliveryIdempotencyKey(
    job.jobId,
    job.deliveryVersion,
  );

  if (job.state === "delivered") {
    const receipt =
      await runtime.coordinator.readDeliveredIfAuthorized(expectedIdentity);
    if (!receipt) failed();
    validateReceipt(receipt, idempotencyKey);
    return publicResult(job);
  }

  const key = await runtime.keyring.readKey(job.keyVersion);
  if (!key) failed();
  const token = deriveInvitationToken(job.jobId, job.keyVersion, key);
  const tokenSha256 = invitationTokenSha256(token);
  if (!SHA256_HEX.test(tokenSha256)) failed();

  const materializationInput: InvitationMaterializationInput = {
    ...expectedIdentity,
    tokenSha256,
  };
  const materialized = validateMaterialization(
    await runtime.coordinator.materializeInvitationAtomically(
      materializationInput,
    ),
    materializationInput,
  );
  await runtime.injectFault?.({ stage: "after-materialization" });

  const deliveryAuthorization = validateDeliveryAuthorization(
    await runtime.coordinator.readDeliveryAuthorizationAtomically({
      ...materializationInput,
      invitationId: materialized.invitationId,
    }),
    materializationInput,
  );
  if (deliveryAuthorization.invitationId !== materialized.invitationId)
    failed();
  await runtime.injectFault?.({ stage: "before-provider" });

  const providerReceipt = validateReceipt(
    await runtime.provider.deliver({
      jobId: job.jobId,
      deliveryVersion: job.deliveryVersion,
      idempotencyKey,
      displayName: job.displayName,
      recipientEmail: deliveryAuthorization.recipient.email,
      invitationToken: token,
    }),
    idempotencyKey,
  );
  await runtime.injectFault?.({ stage: "after-provider" });

  const completedReceipt = validateReceipt(
    await runtime.coordinator.completeDeliveryAtomically({
      ...materializationInput,
      invitationId: materialized.invitationId,
      recipientBinding: deliveryAuthorization.recipientBinding,
      providerReceipt,
    }),
    idempotencyKey,
  );
  if (
    completedReceipt.provider !== providerReceipt.provider ||
    completedReceipt.messageId !== providerReceipt.messageId ||
    completedReceipt.acceptedAt !== providerReceipt.acceptedAt ||
    completedReceipt.idempotencyKey !== providerReceipt.idempotencyKey ||
    completedReceipt.payloadSha256 !== providerReceipt.payloadSha256
  )
    failed();
  await runtime.injectFault?.({ stage: "after-completion" });
  return publicResult(job);
}

/**
 * Worker entry point. The only domain input is an opaque durable job ID;
 * circle, requester, recipient, authorization, versions, and display name are
 * always loaded from the coordinator.
 */
export async function runInvitationWorker(
  jobId: string,
  runtime: InvitationWorkerRuntime,
): Promise<InvitationWorkerResult> {
  if (!runtime || runtime.enabled !== true) disabled();
  try {
    return await runEnabledInvitationWorker(jobId, runtime);
  } catch {
    // Reconstruct the public error at the trust boundary. Even an adapter that
    // throws a mutated/subclassed worker error cannot smuggle private context.
    failed();
  }
}
