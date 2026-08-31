const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u;

export type InvitationProvisioningState =
  "queued" | "provisioned" | "invalidated";

/**
 * Private coordinator result. The normalized address is returned only to the
 * separately deployed provisioner; web clients and public status responses
 * must never receive this record.
 */
export type InvitationProvisioningRequest = Readonly<{
  requestId: string;
  circleId: string;
  requesterMembershipId: string;
  authorizationVersion: string;
  normalizedEmail: string;
  displayName: string;
  state: InvitationProvisioningState;
  requestedAt: string;
}>;

export type InvitationProvisioningIdentity = Readonly<{
  requestId: string;
  circleId: string;
  requesterMembershipId: string;
  authorizationVersion: string;
}>;

export type InvitationProvisioningCompletionInput =
  InvitationProvisioningIdentity &
    Readonly<{
      targetAuthUserId: string;
    }>;

export type InvitationProvisioningResult = Readonly<{
  requestId: string;
  jobId: string;
  state: "provisioned";
}>;

export type InvitationAuthUserSnapshot = Readonly<{
  id: string;
  email: string;
  emailConfirmedAt: string | null;
}>;

export interface InvitationProvisioningCoordinator {
  /**
   * Must atomically reload organizer authority and terminally invalidate stale
   * work before returning a private address to the provisioner.
   */
  loadAuthorizedRequest(
    requestId: string,
  ): Promise<InvitationProvisioningRequest | null>;

  /**
   * Must compare every immutable request identity field, recheck organizer and
   * target eligibility, derive the target address from Auth, and create or
   * compare exactly one target-bound delivery job in one transaction.
   */
  completeProvisioningAtomically(
    input: InvitationProvisioningCompletionInput,
  ): Promise<InvitationProvisioningResult>;

  /** Existing results never bypass fresh requester/target authorization. */
  readProvisionedIfAuthorized(
    input: InvitationProvisioningIdentity,
  ): Promise<InvitationProvisioningResult | null>;
}

export interface InvitationAuthAdminProvisioner {
  /** Exact normalized-email lookup inside the isolated Auth Admin boundary. */
  findByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<InvitationAuthUserSnapshot | null>;

  /**
   * Creates an account without a password, session, or confirmation through
   * the Auth provider's administrative invite path. That path may send the
   * separate one-time Auth confirmation message. Duplicate/lost-response
   * failures are recovered by an exact lookup.
   */
  createUnconfirmedUser(
    normalizedEmail: string,
  ): Promise<InvitationAuthUserSnapshot>;

  /**
   * Sends a fresh Auth code for an account that already existed before this
   * request. Confirmed accounts receive a passwordless sign-in code without
   * public user creation; unconfirmed accounts receive a renewed admin invite.
   */
  sendAuthenticationCode(user: InvitationAuthUserSnapshot): Promise<void>;
}

export type InvitationProvisionerProgress = Readonly<{
  stage:
    | "after-load"
    | "after-lookup"
    | "after-create"
    | "after-authentication-code"
    | "after-completion";
}>;

export type InvitationProvisionerRuntime = Readonly<{
  /** Omitted and false both fail before any privileged dependency is touched. */
  enabled?: boolean;
  coordinator: InvitationProvisioningCoordinator;
  authAdmin: InvitationAuthAdminProvisioner;
  injectFault?: (
    progress: InvitationProvisionerProgress,
  ) => void | Promise<void>;
}>;

export class InvitationProvisionerError extends Error {
  readonly code:
    "INVITATION_PROVISIONING_DISABLED" | "INVITATION_PROVISIONING_FAILED";

  constructor(
    code: "INVITATION_PROVISIONING_DISABLED" | "INVITATION_PROVISIONING_FAILED",
  ) {
    super(
      code === "INVITATION_PROVISIONING_DISABLED"
        ? "Invitation provisioning is disabled."
        : "Invitation provisioning could not be completed.",
    );
    this.name = "InvitationProvisionerError";
    this.code = code;
  }
}

function disabled(): never {
  throw new InvitationProvisionerError("INVITATION_PROVISIONING_DISABLED");
}

function failed(): never {
  throw new InvitationProvisionerError("INVITATION_PROVISIONING_FAILED");
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
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  );
}

function isNormalizedEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 254 &&
    value === value.trim().toLowerCase() &&
    EMAIL.test(value) &&
    !CONTROL_CHARACTER.test(value)
  );
}

function validateRequest(value: unknown): InvitationProvisioningRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "requestId",
      "circleId",
      "requesterMembershipId",
      "authorizationVersion",
      "normalizedEmail",
      "displayName",
      "state",
      "requestedAt",
    ]) ||
    !isCanonicalUuid(value.requestId) ||
    !isCanonicalUuid(value.circleId) ||
    !isCanonicalUuid(value.requesterMembershipId) ||
    !isBoundedRfc3339Timestamp(value.authorizationVersion) ||
    !isNormalizedEmail(value.normalizedEmail) ||
    typeof value.displayName !== "string" ||
    value.displayName !== value.displayName.trim() ||
    Array.from(value.displayName).length < 1 ||
    Array.from(value.displayName).length > 80 ||
    CONTROL_CHARACTER.test(value.displayName) ||
    !["queued", "provisioned", "invalidated"].includes(String(value.state)) ||
    !isCanonicalUtc(value.requestedAt)
  )
    failed();
  return value as InvitationProvisioningRequest;
}

function validateAuthUser(
  value: unknown,
  normalizedEmail: string,
): InvitationAuthUserSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "email", "emailConfirmedAt"]) ||
    !isCanonicalUuid(value.id) ||
    value.email !== normalizedEmail ||
    !isNormalizedEmail(value.email) ||
    (value.emailConfirmedAt !== null &&
      !isBoundedRfc3339Timestamp(value.emailConfirmedAt))
  )
    failed();
  return value as InvitationAuthUserSnapshot;
}

function identity(
  request: InvitationProvisioningRequest,
): InvitationProvisioningIdentity {
  return {
    requestId: request.requestId,
    circleId: request.circleId,
    requesterMembershipId: request.requesterMembershipId,
    authorizationVersion: request.authorizationVersion,
  };
}

function validateResult(
  value: unknown,
  expectedRequestId: string,
): InvitationProvisioningResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["requestId", "jobId", "state"]) ||
    value.requestId !== expectedRequestId ||
    !isCanonicalUuid(value.jobId) ||
    value.state !== "provisioned"
  )
    failed();
  return value as InvitationProvisioningResult;
}

async function runEnabledInvitationProvisioner(
  requestId: string,
  runtime: InvitationProvisionerRuntime,
): Promise<InvitationProvisioningResult> {
  if (!isCanonicalUuid(requestId)) failed();
  const loaded = await runtime.coordinator.loadAuthorizedRequest(requestId);
  if (!loaded) failed();
  const request = validateRequest(loaded);
  if (request.requestId !== requestId || request.state === "invalidated")
    failed();
  const expectedIdentity = identity(request);
  await runtime.injectFault?.({ stage: "after-load" });

  if (request.state === "provisioned") {
    const existing =
      await runtime.coordinator.readProvisionedIfAuthorized(expectedIdentity);
    if (!existing) failed();
    return validateResult(existing, request.requestId);
  }

  let authUser = await runtime.authAdmin.findByNormalizedEmail(
    request.normalizedEmail,
  );
  const existedBeforeRequest = authUser !== null;
  await runtime.injectFault?.({ stage: "after-lookup" });

  if (authUser === null) {
    let createdValue: InvitationAuthUserSnapshot | undefined;
    try {
      createdValue = await runtime.authAdmin.createUnconfirmedUser(
        request.normalizedEmail,
      );
    } catch {
      // A concurrent create or a lost Admin response is resolved only by an
      // exact authoritative lookup. Any other error remains generic.
      authUser = await runtime.authAdmin.findByNormalizedEmail(
        request.normalizedEmail,
      );
      if (authUser === null) failed();
    }
    if (createdValue !== undefined) {
      const created = validateAuthUser(createdValue, request.normalizedEmail);
      if (created.emailConfirmedAt !== null) failed();
      authUser = created;
      await runtime.injectFault?.({ stage: "after-create" });
    }
  }

  const target = validateAuthUser(authUser, request.normalizedEmail);
  if (existedBeforeRequest) {
    await runtime.authAdmin.sendAuthenticationCode(target);
    await runtime.injectFault?.({ stage: "after-authentication-code" });
  }
  const completed = validateResult(
    await runtime.coordinator.completeProvisioningAtomically({
      ...expectedIdentity,
      targetAuthUserId: target.id,
    }),
    request.requestId,
  );
  await runtime.injectFault?.({ stage: "after-completion" });
  return completed;
}

/**
 * Isolated provisioner entry point. It returns only opaque durable IDs and
 * reconstructs every adapter failure at the public worker boundary.
 */
export async function runInvitationProvisioner(
  requestId: string,
  runtime: InvitationProvisionerRuntime,
): Promise<InvitationProvisioningResult> {
  if (!runtime || runtime.enabled !== true) disabled();
  try {
    return await runEnabledInvitationProvisioner(requestId, runtime);
  } catch {
    failed();
  }
}
