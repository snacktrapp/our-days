import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  deriveInvitationToken,
  invitationDeliveryIdempotencyKey,
  invitationTokenSha256,
  InvitationWorkerError,
  runInvitationWorker,
  type ConfirmedInvitationRecipient,
  type InvitationCompletionInput,
  type InvitationDeliveryProvider,
  type InvitationJobCoordinator,
  type InvitationLedgerJob,
  type InvitationProviderReceipt,
  type InvitationWorkerRuntime,
} from ".";
import {
  InMemoryInvitationCoordinator,
  InMemoryInvitationDeliveryProvider,
  InMemoryInvitationTokenKeyring,
} from "./test-support";

const ids = {
  job: "a1000000-0000-4000-8000-000000000001",
  otherJob: "a1000000-0000-4000-8000-000000000002",
  circle: "20000000-0000-4000-8000-000000000001",
  otherCircle: "20000000-0000-4000-8000-000000000002",
  requester: "40000000-0000-4000-8000-000000000001",
  target: "b1000000-0000-4000-8000-000000000001",
} as const;
const authorizationVersion = "2026-08-30T19:59:00.000Z";
const requestedAt = "2026-08-30T20:00:00.000Z";
const confirmedAt = "2026-08-29T20:00:00.000Z";
const recipientEmail = "relative@example.test";
const recipientBinding = "auth-user-email-version:1";
const workerKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

function job(
  overrides: Partial<InvitationLedgerJob> = {},
): InvitationLedgerJob {
  return {
    jobId: ids.job,
    circleId: ids.circle,
    requesterMembershipId: ids.requester,
    authorizationVersion,
    targetAuthUserId: ids.target,
    displayName: "A Relative",
    state: "queued",
    keyVersion: 1,
    deliveryVersion: 1,
    requestedAt,
    ...overrides,
  };
}

function recipient(
  overrides: Partial<ConfirmedInvitationRecipient> = {},
): ConfirmedInvitationRecipient {
  return { email: recipientEmail, confirmedAt, ...overrides };
}

function harness(
  ledger = job(),
  overrides: Partial<InvitationWorkerRuntime> = {},
) {
  const coordinator = new InMemoryInvitationCoordinator(
    ledger,
    recipient(),
    recipientBinding,
  );
  const keyring = new InMemoryInvitationTokenKeyring([[1, workerKey]]);
  const provider = new InMemoryInvitationDeliveryProvider();
  const runtime: InvitationWorkerRuntime = {
    enabled: true,
    coordinator,
    keyring,
    provider,
    ...overrides,
  };
  return { coordinator, keyring, provider, runtime };
}

async function expectFailed(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    name: "InvitationWorkerError",
    code: "INVITATION_DELIVERY_FAILED",
    message: "Invitation delivery could not be completed.",
  });
}

describe("invitation token contract", () => {
  it("derives the exact domain-separated HMAC-SHA256 base64url token", () => {
    const expected = createHmac("sha256", workerKey)
      .update(`our-days/invitation-token/v1\0${1}\0${ids.job}`, "utf8")
      .digest("base64url");
    const token = deriveInvitationToken(ids.job, 1, workerKey);

    expect(token).toBe(expected);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(invitationTokenSha256(token)).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
  });

  it("is stable for one durable job but separates jobs, keys, and key versions", () => {
    const base = deriveInvitationToken(ids.job, 1, workerKey);
    const otherKey = new Uint8Array(workerKey).fill(9);
    expect(deriveInvitationToken(ids.job, 1, workerKey)).toBe(base);
    expect(deriveInvitationToken(ids.otherJob, 1, workerKey)).not.toBe(base);
    expect(deriveInvitationToken(ids.job, 2, workerKey)).not.toBe(base);
    expect(deriveInvitationToken(ids.job, 1, otherKey)).not.toBe(base);
  });

  it.each([
    ["noncanonical job ID", ids.job.toUpperCase(), 1, workerKey],
    ["non-v4 job ID", "a1000000-0000-3000-8000-000000000001", 1, workerKey],
    ["zero key version", ids.job, 0, workerKey],
    ["fractional key version", ids.job, 1.5, workerKey],
    ["short worker key", ids.job, 1, new Uint8Array(31)],
    ["long worker key", ids.job, 1, new Uint8Array(33)],
  ])("rejects %s", (_label, jobId, version, key) => {
    expect(() =>
      deriveInvitationToken(
        jobId as string,
        version as number,
        key as Uint8Array,
      ),
    ).toThrow(InvitationWorkerError);
  });

  it("uses only job ID and delivery version in the provider idempotency key", () => {
    expect(invitationDeliveryIdempotencyKey(ids.job, 3)).toBe(
      `our-days/invitation-delivery/v1:${ids.job}:3`,
    );
    expect(() => invitationDeliveryIdempotencyKey(ids.job, 0)).toThrow(
      InvitationWorkerError,
    );
  });
});

describe("invitation worker fail-closed boundary", () => {
  it.each([undefined, false])(
    "is disabled by default when enabled is %s and touches no dependency",
    async (enabled) => {
      const coordinator = {
        loadAuthorizedJob: vi.fn(),
        materializeInvitationAtomically: vi.fn(),
        readDeliveryAuthorizationAtomically: vi.fn(),
        completeDeliveryAtomically: vi.fn(),
        readDeliveredIfAuthorized: vi.fn(),
      } satisfies InvitationJobCoordinator;
      const keyring = { readKey: vi.fn() };
      const provider = { deliver: vi.fn() };

      await expect(
        runInvitationWorker("not-even-a-job-id", {
          enabled,
          coordinator,
          keyring,
          provider,
        }),
      ).rejects.toMatchObject({
        code: "INVITATION_DELIVERY_DISABLED",
        message: "Invitation delivery is disabled.",
      });
      expect(coordinator.loadAuthorizedJob).not.toHaveBeenCalled();
      expect(keyring.readKey).not.toHaveBeenCalled();
      expect(provider.deliver).not.toHaveBeenCalled();
    },
  );

  it("loads all authority and delivery identity from one opaque job ID", async () => {
    const { coordinator, provider, runtime } = harness();
    const result = await runInvitationWorker(ids.job, runtime);

    expect(result).toEqual({
      jobId: ids.job,
      state: "delivered",
      deliveryVersion: 1,
    });
    expect(Object.keys(result).sort()).toEqual([
      "deliveryVersion",
      "jobId",
      "state",
    ]);
    expect(provider.lastInput).toMatchObject({
      jobId: ids.job,
      deliveryVersion: 1,
      displayName: "A Relative",
      recipientEmail,
      idempotencyKey: invitationDeliveryIdempotencyKey(ids.job, 1),
    });
    expect(provider.lastInput?.invitationToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(coordinator.lastMaterializationInput).toEqual({
      jobId: ids.job,
      circleId: ids.circle,
      requesterMembershipId: ids.requester,
      authorizationVersion,
      targetAuthUserId: ids.target,
      deliveryVersion: 1,
      tokenSha256: invitationTokenSha256(
        deriveInvitationToken(ids.job, 1, workerKey),
      ),
    });
    const coordinatorInput = JSON.stringify({
      materialization: coordinator.lastMaterializationInput,
      completion: coordinator.lastCompletionInput,
    });
    expect(coordinatorInput).not.toContain(recipientEmail);
    expect(coordinatorInput).not.toContain(
      provider.lastInput?.invitationToken ?? "unreachable",
    );
    expect(coordinatorInput).not.toMatch(/https?:|action.?link/iu);
  });

  it("materializes and completes exactly once on the success path", async () => {
    const { coordinator, keyring, provider, runtime } = harness();
    await expect(runInvitationWorker(ids.job, runtime)).resolves.toMatchObject({
      state: "delivered",
    });
    expect(coordinator.materializationWrites).toBe(1);
    expect(coordinator.completionWrites).toBe(1);
    expect(coordinator.calls).toEqual({
      load: 1,
      materialize: 1,
      readDeliveryAuthorization: 1,
      complete: 1,
      readDelivered: 0,
    });
    expect(keyring.calls).toBe(1);
    expect(provider.calls).toBe(1);
    expect(provider.sends).toBe(1);
  });

  it("delivers to an exact provisioned account before its email is confirmed", async () => {
    const coordinator = new InMemoryInvitationCoordinator(
      job(),
      recipient({ confirmedAt: null }),
      "auth-user-email-unconfirmed:1",
    );
    const keyring = new InMemoryInvitationTokenKeyring([[1, workerKey]]);
    const provider = new InMemoryInvitationDeliveryProvider();

    await expect(
      runInvitationWorker(ids.job, {
        enabled: true,
        coordinator,
        keyring,
        provider,
      }),
    ).resolves.toMatchObject({ state: "delivered" });
    expect(provider.lastInput?.recipientEmail).toBe(recipientEmail);
    expect(coordinator.lastCompletionInput?.recipientBinding).toBe(
      "auth-user-email-unconfirmed:1",
    );
  });

  it("maps dependency errors to a stable message without leaking private values", async () => {
    const privateValues = [
      recipientEmail,
      recipientBinding,
      deriveInvitationToken(ids.job, 1, workerKey),
      "https://journal.example.test/invite#private",
    ];
    const provider: InvitationDeliveryProvider = {
      deliver: vi.fn().mockRejectedValue(new Error(privateValues.join(" "))),
    };
    const { runtime } = harness(job(), { provider });
    let caught: unknown;
    try {
      await runInvitationWorker(ids.job, runtime);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "INVITATION_DELIVERY_FAILED",
      message: "Invitation delivery could not be completed.",
    });
    const publicError = JSON.stringify(caught);
    privateValues.forEach((value) => expect(publicError).not.toContain(value));
  });

  it("reconstructs even a mutated worker error thrown by an adapter", async () => {
    const leaked = new InvitationWorkerError("INVITATION_DELIVERY_FAILED");
    leaked.message = `${recipientEmail} ${recipientBinding}`;
    const provider: InvitationDeliveryProvider = {
      deliver: vi.fn().mockRejectedValue(leaked),
    };
    const { runtime } = harness(job(), { provider });

    let caught: unknown;
    try {
      await runInvitationWorker(ids.job, runtime);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "INVITATION_DELIVERY_FAILED",
      message: "Invitation delivery could not be completed.",
    });
    expect(JSON.stringify(caught)).not.toContain(recipientEmail);
    expect(JSON.stringify(caught)).not.toContain(recipientBinding);
  });

  it("never exposes recipient identity, binding, token, or link in its result", async () => {
    const { provider, runtime } = harness();
    const result = await runInvitationWorker(ids.job, runtime);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(recipientEmail);
    expect(serialized).not.toContain(recipientBinding);
    expect(serialized).not.toContain(
      provider.lastInput?.invitationToken ?? "unreachable",
    );
    expect(serialized).not.toMatch(/https?:|action.?link/iu);
  });
});

describe("invitation worker runtime validation", () => {
  const invalidJobs: readonly (readonly [string, InvitationLedgerJob])[] = [
    ["uppercase UUID", job({ jobId: ids.job.toUpperCase() })],
    ["non-v4 UUID", job({ circleId: "20000000-0000-3000-8000-000000000001" })],
    [
      "noncanonical authorization time",
      job({ authorizationVersion: "2026-08-30 19:59:00+00" }),
    ],
    [
      "noncanonical request time",
      job({ requestedAt: "2026-08-30T20:00:00+00:00" }),
    ],
    [
      "invalid calendar date",
      job({ authorizationVersion: "2026-02-30T00:00:00Z" }),
    ],
    [
      "over-precision timestamp",
      job({ authorizationVersion: "2026-08-30T19:59:00.1234567Z" }),
    ],
    [
      "out-of-range offset",
      job({ authorizationVersion: "2026-08-30T19:59:00+14:01" }),
    ],
    ["untrimmed display name", job({ displayName: " A Relative" })],
    ["empty display name", job({ displayName: "" })],
    ["control character", job({ displayName: "A\nRelative" })],
    ["overlong display name", job({ displayName: "a".repeat(81) })],
    ["zero key version", job({ keyVersion: 0 })],
    ["fractional delivery version", job({ deliveryVersion: 1.5 })],
    ["unknown state", job({ state: "processing" as "queued" })],
  ];

  it.each(invalidJobs)(
    "rejects a ledger job with %s before recipient lookup",
    async (_label, invalidJob) => {
      const { keyring, provider, runtime } = harness(invalidJob);
      await expectFailed(runInvitationWorker(ids.job, runtime));
      expect(keyring.calls).toBe(0);
      expect(provider.calls).toBe(0);
    },
  );

  it("rejects extra ledger fields rather than silently accepting schema drift", async () => {
    const invalidJob = {
      ...job(),
      email: recipientEmail,
    } as InvitationLedgerJob;
    const { keyring, runtime } = harness(invalidJob);
    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(keyring.calls).toBe(0);
  });

  it.each([
    "2026-08-30T19:59:00Z",
    "2026-08-30T19:59:00.1Z",
    "2026-08-30T19:59:00.123456Z",
    "2026-08-30T19:59:00.123456-07:00",
    "2026-08-31T02:59:00.123456+07:00",
  ])(
    "preserves the opaque authorization version exactly: %s",
    async (opaqueVersion) => {
      const { coordinator, runtime } = harness(
        job({ authorizationVersion: opaqueVersion }),
      );
      await runInvitationWorker(ids.job, runtime);
      expect(coordinator.lastMaterializationInput?.authorizationVersion).toBe(
        opaqueVersion,
      );
      expect(coordinator.lastCompletionInput?.authorizationVersion).toBe(
        opaqueVersion,
      );
    },
  );

  it.each([
    ["mixed case", recipient({ email: "Relative@example.test" })],
    ["surrounding whitespace", recipient({ email: ` ${recipientEmail}` })],
    ["malformed address", recipient({ email: "not-an-email" })],
    [
      "overlong address",
      recipient({ email: `${"a".repeat(243)}@example.test` }),
    ],
    [
      "noncanonical confirmation time",
      recipient({ confirmedAt: "2026-08-29 20:00:00+00" }),
    ],
  ] as const)(
    "rejects a recipient with %s",
    async (_label, invalidRecipient) => {
      const base = harness();
      base.coordinator.setRecipient(invalidRecipient, recipientBinding);
      const { coordinator, keyring, provider, runtime } = base;
      await expectFailed(runInvitationWorker(ids.job, runtime));
      expect(coordinator.calls.materialize).toBe(1);
      expect(keyring.calls).toBe(1);
      expect(provider.calls).toBe(0);
    },
  );

  it("rejects an absent confirmed recipient and an absent or malformed worker key", async () => {
    const first = harness();
    first.coordinator.setRecipient(null, null);
    await expectFailed(runInvitationWorker(ids.job, first.runtime));
    expect(first.coordinator.calls.materialize).toBe(0);

    const noKey = new InMemoryInvitationTokenKeyring();
    const second = harness(job(), { keyring: noKey });
    await expectFailed(runInvitationWorker(ids.job, second.runtime));
    expect(second.coordinator.calls.materialize).toBe(0);

    const malformedKey = new InMemoryInvitationTokenKeyring([
      [1, new Uint8Array(31)],
    ]);
    const third = harness(job(), { keyring: malformedKey });
    await expectFailed(runInvitationWorker(ids.job, third.runtime));
    expect(third.coordinator.calls.materialize).toBe(0);
  });

  it.each([
    ["empty", ""],
    ["control character", "recipient\nbinding"],
    ["overlong", "b".repeat(201)],
  ])(
    "rejects a %s recipient binding before provider delivery",
    async (_label, binding) => {
      const base = harness();
      base.coordinator.setRecipient(recipient(), binding);
      await expectFailed(runInvitationWorker(ids.job, base.runtime));
      expect(base.provider.calls).toBe(0);
    },
  );

  it("rejects extra pre-provider authorization fields", async () => {
    const base = harness();
    const coordinator: InvitationJobCoordinator = {
      loadAuthorizedJob: base.coordinator.loadAuthorizedJob.bind(
        base.coordinator,
      ),
      materializeInvitationAtomically:
        base.coordinator.materializeInvitationAtomically.bind(base.coordinator),
      readDeliveryAuthorizationAtomically: async (input) => ({
        ...(await base.coordinator.readDeliveryAuthorizationAtomically(input)),
        rawToken: "must-not-exist",
      }),
      completeDeliveryAtomically:
        base.coordinator.completeDeliveryAtomically.bind(base.coordinator),
      readDeliveredIfAuthorized:
        base.coordinator.readDeliveredIfAuthorized.bind(base.coordinator),
    };
    const runtime: InvitationWorkerRuntime = { ...base.runtime, coordinator };

    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(base.provider.calls).toBe(0);
  });

  it("rejects malformed materialization output before provider delivery", async () => {
    const base = new InMemoryInvitationCoordinator(
      job(),
      recipient(),
      recipientBinding,
    );
    const coordinator: InvitationJobCoordinator = {
      ...base,
      loadAuthorizedJob: base.loadAuthorizedJob.bind(base),
      materializeInvitationAtomically: vi.fn().mockResolvedValue({
        invitationId: ids.job,
        tokenSha256: "0".repeat(64),
        deliveryVersion: 1,
        rawToken: "must-not-exist",
      }),
      readDeliveryAuthorizationAtomically:
        base.readDeliveryAuthorizationAtomically.bind(base),
      completeDeliveryAtomically: base.completeDeliveryAtomically.bind(base),
      readDeliveredIfAuthorized: base.readDeliveredIfAuthorized.bind(base),
    };
    const { provider, runtime } = harness(job(), { coordinator });
    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(provider.calls).toBe(0);
  });

  it.each([
    ["unknown provider", { provider: "Provider Name" }],
    ["empty message ID", { messageId: "" }],
    ["noncanonical acceptance time", { acceptedAt: "2026-08-30T20:00:02Z" }],
    ["wrong idempotency key", { idempotencyKey: "wrong" }],
    ["invalid payload checksum", { payloadSha256: "A".repeat(64) }],
  ] as const)(
    "rejects a provider receipt with %s",
    async (_label, override) => {
      const expectedKey = invitationDeliveryIdempotencyKey(ids.job, 1);
      const provider: InvitationDeliveryProvider = {
        deliver: vi.fn().mockResolvedValue({
          provider: "mail-test",
          messageId: "message-1",
          acceptedAt: "2026-08-30T20:00:02.000Z",
          idempotencyKey: expectedKey,
          payloadSha256: "a".repeat(64),
          ...override,
        }),
      };
      const { coordinator, runtime } = harness(job(), { provider });
      await expectFailed(runInvitationWorker(ids.job, runtime));
      expect(coordinator.calls.complete).toBe(0);
    },
  );

  it("rejects extra receipt fields", async () => {
    const provider: InvitationDeliveryProvider = {
      deliver: vi.fn().mockResolvedValue({
        provider: "mail-test",
        messageId: "message-1",
        acceptedAt: "2026-08-30T20:00:02.000Z",
        idempotencyKey: invitationDeliveryIdempotencyKey(ids.job, 1),
        payloadSha256: "a".repeat(64),
        recipientEmail,
      }),
    };
    const { coordinator, runtime } = harness(job(), { provider });
    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(coordinator.calls.complete).toBe(0);
  });
});

describe("invitation worker retries and authorization races", () => {
  it("converges after a crash immediately after materialization", async () => {
    let failOnce = true;
    const { coordinator, provider, runtime } = harness(job(), {
      injectFault: ({ stage }) => {
        if (stage === "after-materialization" && failOnce) {
          failOnce = false;
          throw new Error("worker stopped");
        }
      },
    });
    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(coordinator.materializationWrites).toBe(1);
    expect(provider.sends).toBe(0);

    await expect(runInvitationWorker(ids.job, runtime)).resolves.toMatchObject({
      state: "delivered",
    });
    expect(coordinator.materializationWrites).toBe(1);
    expect(coordinator.completionWrites).toBe(1);
    expect(provider.sends).toBe(1);
  });

  it("converges after the provider accepted but its response was lost", async () => {
    const { coordinator, provider, runtime } = harness();
    provider.loseResponseAfterAcceptOnce();

    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(provider.calls).toBe(1);
    expect(provider.sends).toBe(1);
    expect(coordinator.completionWrites).toBe(0);

    await expect(runInvitationWorker(ids.job, runtime)).resolves.toMatchObject({
      state: "delivered",
    });
    expect(provider.calls).toBe(2);
    expect(provider.sends).toBe(1);
    expect(coordinator.materializationWrites).toBe(1);
    expect(coordinator.completionWrites).toBe(1);
  });

  it("converges after a crash between provider response and completion", async () => {
    let failOnce = true;
    const { coordinator, provider, runtime } = harness(job(), {
      injectFault: ({ stage }) => {
        if (stage === "after-provider" && failOnce) {
          failOnce = false;
          throw new Error("worker stopped");
        }
      },
    });

    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(provider.sends).toBe(1);
    expect(coordinator.completionWrites).toBe(0);
    await expect(runInvitationWorker(ids.job, runtime)).resolves.toMatchObject({
      state: "delivered",
    });
    expect(provider.calls).toBe(2);
    expect(provider.sends).toBe(1);
    expect(coordinator.completionWrites).toBe(1);
  });

  it("converges when atomic completion persisted but its response was lost", async () => {
    const { coordinator, keyring, provider, runtime } = harness();
    coordinator.loseCompletionResponseOnce();

    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(coordinator.completionWrites).toBe(1);
    expect(provider.sends).toBe(1);
    const keyCalls = keyring.calls;

    await expect(runInvitationWorker(ids.job, runtime)).resolves.toEqual({
      jobId: ids.job,
      state: "delivered",
      deliveryVersion: 1,
    });
    expect(coordinator.completionWrites).toBe(1);
    expect(provider.sends).toBe(1);
    expect(keyring.calls).toBe(keyCalls);
    expect(coordinator.calls.readDelivered).toBe(1);
  });

  it("fails before recipient lookup when requester authority is already revoked", async () => {
    const { coordinator, keyring, provider, runtime } = harness();
    coordinator.invalidate();
    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(keyring.calls).toBe(0);
    expect(provider.calls).toBe(0);
    expect(coordinator.invitationLive).toBe(false);
  });

  it("reauthorizes after materialization and does not send after revocation", async () => {
    let revokeOnce = true;
    const base = harness();
    const runtime: InvitationWorkerRuntime = {
      ...base.runtime,
      injectFault: ({ stage }) => {
        if (stage === "after-materialization" && revokeOnce) {
          revokeOnce = false;
          base.coordinator.invalidate();
        }
      },
    };

    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(base.coordinator.materializationWrites).toBe(1);
    expect(base.coordinator.calls.readDeliveryAuthorization).toBe(1);
    expect(base.provider.sends).toBe(0);
    expect(base.coordinator.invitationLive).toBe(false);
  });

  it("uses a recipient changed before the atomic pre-send snapshot", async () => {
    const changedEmail = "changed@example.test";
    const changedBinding = "auth-user-email-version:2";
    let changeOnce = true;
    const base = harness();
    const runtime: InvitationWorkerRuntime = {
      ...base.runtime,
      injectFault: ({ stage }) => {
        if (stage === "after-materialization" && changeOnce) {
          changeOnce = false;
          base.coordinator.setRecipient(
            recipient({ email: changedEmail }),
            changedBinding,
          );
        }
      },
    };

    await expect(runInvitationWorker(ids.job, runtime)).resolves.toMatchObject({
      state: "delivered",
    });
    expect(base.provider.lastInput?.recipientEmail).toBe(changedEmail);
    expect(base.coordinator.lastCompletionInput?.recipientBinding).toBe(
      changedBinding,
    );
  });

  it("invalidates the job and invitation when recipient confirmation is lost after materialization", async () => {
    let loseOnce = true;
    const base = harness();
    const runtime: InvitationWorkerRuntime = {
      ...base.runtime,
      injectFault: ({ stage }) => {
        if (stage === "after-materialization" && loseOnce) {
          loseOnce = false;
          base.coordinator.setRecipient(null, null);
        }
      },
    };

    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(base.provider.sends).toBe(0);
    expect(base.coordinator.invitationLive).toBe(false);
    await expectFailed(runInvitationWorker(ids.job, runtime));
  });

  it("rejects a changed recipient binding at completion and invalidates the bearer invitation", async () => {
    let changeOnce = true;
    const base = harness();
    const runtime: InvitationWorkerRuntime = {
      ...base.runtime,
      injectFault: ({ stage }) => {
        if (stage === "after-provider" && changeOnce) {
          changeOnce = false;
          base.coordinator.setRecipient(
            recipient({ email: "changed@example.test" }),
            "auth-user-email-version:2",
          );
        }
      },
    };

    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(base.provider.lastInput?.recipientEmail).toBe(recipientEmail);
    expect(base.provider.sends).toBe(1);
    expect(base.coordinator.completionWrites).toBe(0);
    expect(base.coordinator.invitationLive).toBe(false);
    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(base.provider.sends).toBe(1);
  });

  it("atomically invalidates after the target becomes active in the same circle", async () => {
    let activateOnce = true;
    const base = harness();
    const runtime: InvitationWorkerRuntime = {
      ...base.runtime,
      injectFault: ({ stage }) => {
        if (stage === "after-materialization" && activateOnce) {
          activateOnce = false;
          base.coordinator.setTargetInvitable(false);
        }
      },
    };

    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(base.provider.sends).toBe(0);
    expect(base.coordinator.invitationLive).toBe(false);
  });

  it("fails completion and leaves a sent link invalid after post-send revocation", async () => {
    let revokeOnce = true;
    const base = harness();
    const runtime: InvitationWorkerRuntime = {
      ...base.runtime,
      injectFault: ({ stage }) => {
        if (stage === "after-provider" && revokeOnce) {
          revokeOnce = false;
          base.coordinator.invalidate();
        }
      },
    };

    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(base.provider.sends).toBe(1);
    expect(base.coordinator.completionWrites).toBe(0);
    expect(base.coordinator.invitationLive).toBe(false);
    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(base.provider.sends).toBe(1);
  });

  it("fails closed when revocation lands in the final pre-provider race window", async () => {
    let revokeOnce = true;
    const base = harness();
    const runtime: InvitationWorkerRuntime = {
      ...base.runtime,
      injectFault: ({ stage }) => {
        if (stage === "before-provider" && revokeOnce) {
          revokeOnce = false;
          base.coordinator.invalidate();
        }
      },
    };

    // An external send cannot share the database authorization transaction.
    // The residual race may emit email, but atomic completion rejects and the
    // coordinator has already invalidated the underlying invitation.
    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(base.provider.sends).toBe(1);
    expect(base.coordinator.completionWrites).toBe(0);
    expect(base.coordinator.invitationLive).toBe(false);
  });

  it("freshly reauthorizes an existing delivered result without recipient or provider access", async () => {
    const { coordinator, keyring, provider, runtime } = harness();
    await runInvitationWorker(ids.job, runtime);
    const before = {
      keyCalls: keyring.calls,
      providerCalls: provider.calls,
    };

    await expect(runInvitationWorker(ids.job, runtime)).resolves.toMatchObject({
      state: "delivered",
    });
    expect(keyring.calls).toBe(before.keyCalls);
    expect(provider.calls).toBe(before.providerCalls);
    expect(coordinator.calls.readDelivered).toBe(1);

    coordinator.invalidate();
    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(provider.calls).toBe(before.providerCalls);
  });

  it("fails a delivered read when the target is now active in the same circle", async () => {
    const { coordinator, provider, runtime } = harness();
    await runInvitationWorker(ids.job, runtime);
    const sends = provider.sends;
    coordinator.setTargetInvitable(false);

    await expectFailed(runInvitationWorker(ids.job, runtime));
    expect(provider.sends).toBe(sends);
    expect(coordinator.invitationLive).toBe(false);
  });

  it("atomically compares every provider receipt field on duplicate completion", async () => {
    const { coordinator, runtime } = harness();
    await runInvitationWorker(ids.job, runtime);
    const first = coordinator.lastCompletionInput;
    expect(first).not.toBeNull();
    const fields: readonly (keyof InvitationProviderReceipt)[] = [
      "provider",
      "messageId",
      "acceptedAt",
      "idempotencyKey",
    ];
    for (const field of fields) {
      const conflicting = {
        ...first!,
        providerReceipt: {
          ...first!.providerReceipt,
          [field]: `${first!.providerReceipt[field]}-conflict`,
        },
      } satisfies InvitationCompletionInput;
      await expect(
        coordinator.completeDeliveryAtomically(conflicting),
      ).rejects.toBeInstanceOf(InvitationWorkerError);
    }
    expect(coordinator.completionWrites).toBe(1);
  });

  it("atomically rejects changed job identity and a no-longer-live invitation", async () => {
    const first = harness();
    await first.coordinator.loadAuthorizedJob(ids.job);
    const tokenSha256 = invitationTokenSha256(
      deriveInvitationToken(ids.job, 1, workerKey),
    );
    const materializationInput = {
      jobId: ids.job,
      circleId: ids.circle,
      requesterMembershipId: ids.requester,
      authorizationVersion,
      targetAuthUserId: ids.target,
      deliveryVersion: 1,
      tokenSha256,
    } as const;
    const materialized =
      await first.coordinator.materializeInvitationAtomically(
        materializationInput,
      );
    const invitationId = materialized.invitationId;
    const receipt: InvitationProviderReceipt = {
      provider: "mail-test",
      messageId: "message-1",
      acceptedAt: "2026-08-30T20:00:02.000Z",
      idempotencyKey: invitationDeliveryIdempotencyKey(ids.job, 1),
      payloadSha256: "a".repeat(64),
    };
    await expect(
      first.coordinator.completeDeliveryAtomically({
        ...materializationInput,
        circleId: ids.otherCircle,
        invitationId,
        recipientBinding,
        providerReceipt: receipt,
      }),
    ).rejects.toBeInstanceOf(InvitationWorkerError);

    first.coordinator.corruptInvitation();
    await expect(
      first.coordinator.completeDeliveryAtomically({
        ...materializationInput,
        invitationId,
        recipientBinding,
        providerReceipt: receipt,
      }),
    ).rejects.toBeInstanceOf(InvitationWorkerError);
    expect(first.coordinator.completionWrites).toBe(0);
  });
});
