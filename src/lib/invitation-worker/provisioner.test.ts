import { describe, expect, it, vi } from "vitest";
import {
  InvitationProvisionerError,
  runInvitationProvisioner,
  type InvitationAuthAdminProvisioner,
  type InvitationAuthUserSnapshot,
  type InvitationProvisioningCompletionInput,
  type InvitationProvisioningCoordinator,
  type InvitationProvisioningRequest,
  type InvitationProvisioningResult,
  type InvitationProvisionerRuntime,
} from "./provisioner";

const ids = {
  request: "a2000000-0000-4000-8000-000000000001",
  job: "a2000000-0000-4000-8000-000000000002",
  circle: "20000000-0000-4000-8000-000000000001",
  requester: "40000000-0000-4000-8000-000000000001",
  target: "b2000000-0000-4000-8000-000000000001",
} as const;
const email = "new.relative@example.test";
const authorizationVersion = "2026-08-31T12:00:00.123456-07:00";

function request(
  overrides: Partial<InvitationProvisioningRequest> = {},
): InvitationProvisioningRequest {
  return {
    requestId: ids.request,
    circleId: ids.circle,
    requesterMembershipId: ids.requester,
    authorizationVersion,
    normalizedEmail: email,
    displayName: "A Relative",
    state: "queued",
    requestedAt: "2026-08-31T19:00:00.000Z",
    ...overrides,
  };
}

function user(
  overrides: Partial<InvitationAuthUserSnapshot> = {},
): InvitationAuthUserSnapshot {
  return { id: ids.target, email, emailConfirmedAt: null, ...overrides };
}

class Coordinator implements InvitationProvisioningCoordinator {
  current: InvitationProvisioningRequest;
  result: InvitationProvisioningResult | null = null;
  lastCompletion: InvitationProvisioningCompletionInput | null = null;
  loadCalls = 0;
  readCalls = 0;

  constructor(initial = request()) {
    this.current = initial;
  }

  async loadAuthorizedRequest(): Promise<InvitationProvisioningRequest | null> {
    this.loadCalls += 1;
    return this.current;
  }

  async completeProvisioningAtomically(
    input: InvitationProvisioningCompletionInput,
  ) {
    this.lastCompletion = input;
    this.result = {
      requestId: this.current.requestId,
      jobId: ids.job,
      state: "provisioned",
    };
    this.current = { ...this.current, state: "provisioned" };
    return this.result;
  }

  async readProvisionedIfAuthorized() {
    this.readCalls += 1;
    return this.result;
  }
}

class AuthAdmin implements InvitationAuthAdminProvisioner {
  current: InvitationAuthUserSnapshot | null;
  createCalls = 0;
  findCalls = 0;
  sendCodeCalls = 0;
  throwAfterCreate = false;
  createValue: InvitationAuthUserSnapshot;

  constructor(existing: InvitationAuthUserSnapshot | null = null) {
    this.current = existing;
    this.createValue = user();
  }

  async findByNormalizedEmail() {
    this.findCalls += 1;
    return this.current;
  }

  async createUnconfirmedUser() {
    this.createCalls += 1;
    this.current = this.createValue;
    if (this.throwAfterCreate) throw new Error(`lost response for ${email}`);
    return this.createValue;
  }

  async sendAuthenticationCode() {
    this.sendCodeCalls += 1;
  }
}

function harness(
  initial = request(),
  existing: InvitationAuthUserSnapshot | null = null,
) {
  const coordinator = new Coordinator(initial);
  const authAdmin = new AuthAdmin(existing);
  const runtime: InvitationProvisionerRuntime = {
    enabled: true,
    coordinator,
    authAdmin,
  };
  return { authAdmin, coordinator, runtime };
}

async function expectFailed(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    name: "InvitationProvisionerError",
    code: "INVITATION_PROVISIONING_FAILED",
    message: "Invitation provisioning could not be completed.",
  });
}

describe("invitation Auth provisioner boundary", () => {
  it.each([undefined, false])(
    "is disabled by default when enabled is %s and touches nothing privileged",
    async (enabled) => {
      const coordinator = {
        loadAuthorizedRequest: vi.fn(),
        completeProvisioningAtomically: vi.fn(),
        readProvisionedIfAuthorized: vi.fn(),
      } satisfies InvitationProvisioningCoordinator;
      const authAdmin = {
        findByNormalizedEmail: vi.fn(),
        createUnconfirmedUser: vi.fn(),
        sendAuthenticationCode: vi.fn(),
      } satisfies InvitationAuthAdminProvisioner;

      await expect(
        runInvitationProvisioner("not-a-request", {
          enabled,
          coordinator,
          authAdmin,
        }),
      ).rejects.toMatchObject({
        code: "INVITATION_PROVISIONING_DISABLED",
      });
      expect(coordinator.loadAuthorizedRequest).not.toHaveBeenCalled();
      expect(authAdmin.findByNormalizedEmail).not.toHaveBeenCalled();
      expect(authAdmin.createUnconfirmedUser).not.toHaveBeenCalled();
      expect(authAdmin.sendAuthenticationCode).not.toHaveBeenCalled();
    },
  );

  it("creates an unconfirmed exact-address account and returns only opaque IDs", async () => {
    const { authAdmin, coordinator, runtime } = harness();
    await expect(
      runInvitationProvisioner(ids.request, runtime),
    ).resolves.toEqual({
      requestId: ids.request,
      jobId: ids.job,
      state: "provisioned",
    });
    expect(authAdmin.findCalls).toBe(1);
    expect(authAdmin.createCalls).toBe(1);
    expect(authAdmin.sendCodeCalls).toBe(0);
    expect(coordinator.lastCompletion).toEqual({
      requestId: ids.request,
      circleId: ids.circle,
      requesterMembershipId: ids.requester,
      authorizationVersion,
      targetAuthUserId: ids.target,
    });
    expect(JSON.stringify(coordinator.lastCompletion)).not.toContain(email);
  });

  it("reuses an existing confirmed exact-address account and sends a fresh sign-in code", async () => {
    const existing = user({
      emailConfirmedAt: "2026-08-31T18:00:00.000Z",
    });
    const { authAdmin, runtime } = harness(request(), existing);
    await expect(
      runInvitationProvisioner(ids.request, runtime),
    ).resolves.toMatchObject({ state: "provisioned" });
    expect(authAdmin.createCalls).toBe(0);
    expect(authAdmin.sendCodeCalls).toBe(1);
  });

  it("renews the Auth invitation code for an existing unconfirmed account", async () => {
    const { authAdmin, runtime } = harness(request(), user());
    await expect(
      runInvitationProvisioner(ids.request, runtime),
    ).resolves.toMatchObject({ state: "provisioned" });
    expect(authAdmin.createCalls).toBe(0);
    expect(authAdmin.sendCodeCalls).toBe(1);
  });

  it("recovers an Auth Admin lost response by exact authoritative lookup", async () => {
    const { authAdmin, runtime } = harness();
    authAdmin.throwAfterCreate = true;
    await expect(
      runInvitationProvisioner(ids.request, runtime),
    ).resolves.toMatchObject({ state: "provisioned" });
    expect(authAdmin.createCalls).toBe(1);
    expect(authAdmin.findCalls).toBe(2);
  });

  it("converges after a crash immediately following account creation", async () => {
    const { authAdmin, coordinator, runtime } = harness();
    await expectFailed(
      runInvitationProvisioner(ids.request, {
        ...runtime,
        injectFault: ({ stage }) => {
          if (stage === "after-create") throw new Error("synthetic crash");
        },
      }),
    );
    expect(authAdmin.current?.id).toBe(ids.target);
    expect(coordinator.lastCompletion).toBeNull();
    await expect(
      runInvitationProvisioner(ids.request, runtime),
    ).resolves.toMatchObject({ state: "provisioned" });
    expect(authAdmin.createCalls).toBe(1);
  });

  it("converges through a fresh authorization read after completion response loss", async () => {
    const { authAdmin, coordinator, runtime } = harness();
    await expectFailed(
      runInvitationProvisioner(ids.request, {
        ...runtime,
        injectFault: ({ stage }) => {
          if (stage === "after-completion") throw new Error("lost completion");
        },
      }),
    );
    expect(coordinator.current.state).toBe("provisioned");
    await expect(
      runInvitationProvisioner(ids.request, runtime),
    ).resolves.toEqual(coordinator.result);
    expect(coordinator.readCalls).toBe(1);
    expect(authAdmin.createCalls).toBe(1);
  });

  it("does not accept an Auth adapter that falsely pre-confirms a new user", async () => {
    const { authAdmin, coordinator, runtime } = harness();
    authAdmin.createValue = user({
      emailConfirmedAt: "2026-08-31T18:00:00.000Z",
    });
    await expectFailed(runInvitationProvisioner(ids.request, runtime));
    expect(coordinator.lastCompletion).toBeNull();
  });

  it("rejects a changed or non-normalized Auth address", async () => {
    const { authAdmin, coordinator, runtime } = harness();
    authAdmin.createValue = user({ email: "Other@example.test" });
    await expectFailed(runInvitationProvisioner(ids.request, runtime));
    expect(coordinator.lastCompletion).toBeNull();
  });

  it("freshly authorizes an existing provisioned result without touching Auth Admin", async () => {
    const { authAdmin, coordinator, runtime } = harness(
      request({ state: "provisioned" }),
    );
    coordinator.result = {
      requestId: ids.request,
      jobId: ids.job,
      state: "provisioned",
    };
    await expect(
      runInvitationProvisioner(ids.request, runtime),
    ).resolves.toEqual(coordinator.result);
    expect(coordinator.readCalls).toBe(1);
    expect(authAdmin.findCalls).toBe(0);
    expect(authAdmin.createCalls).toBe(0);
    expect(authAdmin.sendCodeCalls).toBe(0);
  });

  it("fails closed when an existing-result authorization read disappears", async () => {
    const { authAdmin, coordinator, runtime } = harness(
      request({ state: "provisioned" }),
    );
    await expectFailed(runInvitationProvisioner(ids.request, runtime));
    expect(coordinator.readCalls).toBe(1);
    expect(authAdmin.findCalls).toBe(0);
  });

  it("preserves the opaque authorization timestamp byte-for-byte", async () => {
    const { coordinator, runtime } = harness();
    await runInvitationProvisioner(ids.request, runtime);
    expect(coordinator.lastCompletion?.authorizationVersion).toBe(
      authorizationVersion,
    );
  });

  it.each([
    ["unknown request", null],
    ["invalidated request", request({ state: "invalidated" })],
    ["uppercase request ID", request({ requestId: ids.request.toUpperCase() })],
    ["wrong loaded request", request({ requestId: ids.job })],
    ["uppercase email", request({ normalizedEmail: "NEW@example.test" })],
    ["control in name", request({ displayName: "A\u0000Relative" })],
    ["invalid date", request({ requestedAt: "2026-02-30T19:00:00.000Z" })],
    [
      "invalid authorization offset",
      request({ authorizationVersion: "2026-08-31T19:00:00+14:30" }),
    ],
  ])("rejects %s with one generic error", async (_label, loaded) => {
    const coordinator = new Coordinator();
    coordinator.loadAuthorizedRequest = vi.fn(async () => loaded);
    const authAdmin = new AuthAdmin();
    await expectFailed(
      runInvitationProvisioner(ids.request, {
        enabled: true,
        coordinator,
        authAdmin,
      }),
    );
    expect(authAdmin.findCalls).toBe(0);
  });

  it("reconstructs hostile adapter errors without leaking private text", async () => {
    const { authAdmin, runtime } = harness();
    authAdmin.findByNormalizedEmail = vi.fn(async () => {
      throw new InvitationProvisionerError("INVITATION_PROVISIONING_DISABLED");
    });
    const error = await runInvitationProvisioner(ids.request, runtime).catch(
      (caught: unknown) => caught,
    );
    expect(error).toEqual(
      expect.objectContaining({
        code: "INVITATION_PROVISIONING_FAILED",
        message: "Invitation provisioning could not be completed.",
      }),
    );
    expect(String(error)).not.toContain(email);
  });
});
