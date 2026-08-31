import { createHash } from "node:crypto";
import {
  InvitationWorkerError,
  type ConfirmedInvitationRecipient,
  type InvitationCompletionInput,
  type InvitationDeliveryAuthorization,
  type InvitationDeliveryInput,
  type InvitationDeliveryProvider,
  type InvitationJobCoordinator,
  type InvitationJobIdentity,
  type InvitationLedgerJob,
  type InvitationMaterialization,
  type InvitationMaterializationInput,
  type InvitationProviderReceipt,
  type InvitationRecipientBinding,
  type InvitationTokenKeyring,
} from "./contract";

function failure(): never {
  throw new InvitationWorkerError("INVITATION_DELIVERY_FAILED");
}

function uuidFromJob(jobId: string) {
  const hex = createHash("sha256").update(`invitation\0${jobId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function receiptEqual(
  left: InvitationProviderReceipt,
  right: InvitationProviderReceipt,
) {
  return (
    left.provider === right.provider &&
    left.messageId === right.messageId &&
    left.acceptedAt === right.acceptedAt &&
    left.idempotencyKey === right.idempotencyKey
  );
}

function materializationEqual(
  left: InvitationMaterialization,
  right: InvitationMaterialization,
) {
  return (
    left.invitationId === right.invitationId &&
    left.tokenSha256 === right.tokenSha256 &&
    left.deliveryVersion === right.deliveryVersion
  );
}

/** Pure test double. It is not a production database adapter. */
export class InMemoryInvitationCoordinator implements InvitationJobCoordinator {
  #job: InvitationLedgerJob | null;
  #authorized = true;
  #targetInvitable = true;
  #invitationLive = true;
  #recipient: ConfirmedInvitationRecipient | null;
  #recipientBinding: InvitationRecipientBinding | null;
  #materialization: InvitationMaterialization | null = null;
  #receipt: InvitationProviderReceipt | null = null;
  #materializationWrites = 0;
  #completionWrites = 0;
  #completionResponseLosses = 0;
  #calls = {
    load: 0,
    materialize: 0,
    readDeliveryAuthorization: 0,
    complete: 0,
    readDelivered: 0,
  };
  lastMaterializationInput: InvitationMaterializationInput | null = null;
  lastCompletionInput: InvitationCompletionInput | null = null;

  constructor(
    job: InvitationLedgerJob | null,
    recipient: ConfirmedInvitationRecipient | null,
    recipientBinding: InvitationRecipientBinding | null,
  ) {
    this.#job = job ? { ...job } : null;
    this.#recipient = recipient ? { ...recipient } : null;
    this.#recipientBinding = recipientBinding;
  }

  get calls() {
    return { ...this.#calls };
  }

  get materializationWrites() {
    return this.#materializationWrites;
  }

  get completionWrites() {
    return this.#completionWrites;
  }

  get invitationLive() {
    return this.#invitationLive;
  }

  loseCompletionResponseOnce() {
    this.#completionResponseLosses += 1;
  }

  invalidate() {
    this.#authorized = false;
    this.#invitationLive = false;
    if (this.#job) this.#job = { ...this.#job, state: "invalidated" };
  }

  setAuthorized(value: boolean) {
    this.#authorized = value;
  }

  setTargetInvitable(value: boolean) {
    this.#targetInvitable = value;
  }

  setRecipient(
    recipient: ConfirmedInvitationRecipient | null,
    binding: InvitationRecipientBinding | null,
  ) {
    this.#recipient = recipient ? { ...recipient } : null;
    this.#recipientBinding = binding;
  }

  corruptInvitation() {
    this.#invitationLive = false;
  }

  replaceJob(job: InvitationLedgerJob | null) {
    this.#job = job ? { ...job } : null;
  }

  #invalidateMaterialized() {
    this.#invitationLive = false;
    if (this.#job) this.#job = { ...this.#job, state: "invalidated" };
  }

  #authorize(identity?: InvitationJobIdentity) {
    if (
      !this.#authorized ||
      !this.#targetInvitable ||
      !this.#recipient ||
      !this.#recipientBinding ||
      !this.#job ||
      this.#job.state === "invalidated" ||
      (identity !== undefined &&
        (identity.jobId !== this.#job.jobId ||
          identity.circleId !== this.#job.circleId ||
          identity.requesterMembershipId !== this.#job.requesterMembershipId ||
          identity.authorizationVersion !== this.#job.authorizationVersion ||
          identity.targetAuthUserId !== this.#job.targetAuthUserId ||
          identity.deliveryVersion !== this.#job.deliveryVersion))
    ) {
      if (this.#materialization) this.#invalidateMaterialized();
      failure();
    }
  }

  async loadAuthorizedJob(jobId: string) {
    this.#calls.load += 1;
    this.#authorize();
    return this.#job?.jobId === jobId ? { ...this.#job } : null;
  }

  async materializeInvitationAtomically(input: InvitationMaterializationInput) {
    this.#calls.materialize += 1;
    this.lastMaterializationInput = { ...input };
    this.#authorize(input);
    if (!this.#job || !["queued", "materialized"].includes(this.#job.state))
      failure();
    const desired: InvitationMaterialization = {
      invitationId: uuidFromJob(input.jobId),
      tokenSha256: input.tokenSha256,
      deliveryVersion: input.deliveryVersion,
    };
    if (this.#materialization) {
      if (!materializationEqual(this.#materialization, desired)) failure();
      return { ...this.#materialization };
    }
    this.#materialization = desired;
    this.#job = { ...this.#job, state: "materialized" };
    this.#materializationWrites += 1;
    return { ...desired };
  }

  async readDeliveryAuthorizationAtomically(
    input: InvitationMaterializationInput & Readonly<{ invitationId: string }>,
  ) {
    this.#calls.readDeliveryAuthorization += 1;
    this.#authorize(input);
    if (
      !this.#invitationLive ||
      !this.#materialization ||
      input.invitationId !== this.#materialization.invitationId ||
      input.tokenSha256 !== this.#materialization.tokenSha256 ||
      input.deliveryVersion !== this.#materialization.deliveryVersion
    ) {
      this.#invalidateMaterialized();
      failure();
    }
    if (!this.#recipient || !this.#recipientBinding) failure();
    return {
      ...this.#materialization,
      recipient: { ...this.#recipient },
      recipientBinding: this.#recipientBinding,
    } satisfies InvitationDeliveryAuthorization;
  }

  async completeDeliveryAtomically(input: InvitationCompletionInput) {
    this.#calls.complete += 1;
    this.lastCompletionInput = {
      ...input,
      providerReceipt: { ...input.providerReceipt },
    };
    this.#authorize(input);
    if (
      !this.#job ||
      !["materialized", "delivered"].includes(this.#job.state) ||
      !this.#invitationLive ||
      !this.#materialization ||
      input.invitationId !== this.#materialization.invitationId ||
      input.tokenSha256 !== this.#materialization.tokenSha256 ||
      input.deliveryVersion !== this.#materialization.deliveryVersion ||
      input.recipientBinding !== this.#recipientBinding
    ) {
      this.#invalidateMaterialized();
      failure();
    }
    if (this.#receipt) {
      if (!receiptEqual(this.#receipt, input.providerReceipt)) failure();
    } else {
      this.#receipt = { ...input.providerReceipt };
      this.#job = { ...this.#job, state: "delivered" };
      this.#completionWrites += 1;
    }
    if (this.#completionResponseLosses > 0) {
      this.#completionResponseLosses -= 1;
      throw new Error("simulated lost completion response");
    }
    return { ...this.#receipt };
  }

  async readDeliveredIfAuthorized(input: InvitationJobIdentity) {
    this.#calls.readDelivered += 1;
    this.#authorize(input);
    if (this.#job?.state !== "delivered" || !this.#receipt) return null;
    return { ...this.#receipt };
  }
}

/** Pure test double. It is not a production secret manager. */
export class InMemoryInvitationTokenKeyring implements InvitationTokenKeyring {
  readonly #keys = new Map<number, Uint8Array>();
  #calls = 0;

  constructor(entries: readonly (readonly [number, Uint8Array])[] = []) {
    entries.forEach(([version, key]) =>
      this.#keys.set(version, new Uint8Array(key)),
    );
  }

  get calls() {
    return this.#calls;
  }

  async readKey(keyVersion: number) {
    this.#calls += 1;
    const key = this.#keys.get(keyVersion);
    return key ? new Uint8Array(key) : null;
  }
}

/** Pure idempotent test double. It sends no email and constructs no action URL. */
export class InMemoryInvitationDeliveryProvider implements InvitationDeliveryProvider {
  readonly #accepted = new Map<
    string,
    Readonly<{
      input: InvitationDeliveryInput;
      receipt: InvitationProviderReceipt;
    }>
  >();
  readonly #acceptedAt: string;
  #calls = 0;
  #sends = 0;
  #responseLosses = 0;
  lastInput: InvitationDeliveryInput | null = null;

  constructor(acceptedAt = "2026-08-30T20:00:02.000Z") {
    this.#acceptedAt = acceptedAt;
  }

  get calls() {
    return this.#calls;
  }

  get sends() {
    return this.#sends;
  }

  loseResponseAfterAcceptOnce() {
    this.#responseLosses += 1;
  }

  async deliver(input: InvitationDeliveryInput) {
    this.#calls += 1;
    this.lastInput = { ...input };
    const serialized = JSON.stringify(input);
    const existing = this.#accepted.get(input.idempotencyKey);
    if (existing) {
      if (JSON.stringify(existing.input) !== serialized) failure();
      return { ...existing.receipt };
    }
    const receipt: InvitationProviderReceipt = {
      provider: "in-memory",
      messageId: createHash("sha256")
        .update(input.idempotencyKey)
        .digest("hex")
        .slice(0, 32),
      acceptedAt: this.#acceptedAt,
      idempotencyKey: input.idempotencyKey,
      payloadSha256: createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
    };
    this.#accepted.set(input.idempotencyKey, {
      input: { ...input },
      receipt,
    });
    this.#sends += 1;
    if (this.#responseLosses > 0) {
      this.#responseLosses -= 1;
      throw new Error("simulated lost provider response");
    }
    return { ...receipt };
  }
}
