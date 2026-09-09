// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHeaders: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  revalidatePath: vi.fn(),
  requireAccess: vi.fn(),
  writeCookie: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  createLocalCircle: vi.fn(),
  localJournalIsEnabled: vi.fn(),
  invitationDeliveryIsEnabled: vi.fn(),
  requestInvitation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.getHeaders }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/journal-access", () => ({
  requireJournalAccess: mocks.requireAccess,
  readJournalCircleMemberships: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/features/family-settings/family-settings-actions", () => ({
  requestFamilyInvitationAction: mocks.requestInvitation,
}));
vi.mock("@/lib/auth/active-circle", async () => {
  const shared = await import("@/lib/auth/active-circle-shared");
  return {
    ...shared,
    writeActiveCircleCookie: mocks.writeCookie,
  };
});
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));
vi.mock("@/lib/local-journal/store", () => ({
  createLocalCircle: mocks.createLocalCircle,
}));
vi.mock("../../../config/our-days-environment", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../config/our-days-environment")
    >();
  return {
    ...actual,
    localJournalIsEnabled: mocks.localJournalIsEnabled,
    invitationDeliveryIsEnabled: mocks.invitationDeliveryIsEnabled,
  };
});

import { createGroupAction } from "./create-group-action";

const circleId = "20000000-0000-4000-8000-000000000099";

describe("create circle action", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    mocks.getHeaders.mockResolvedValue(
      new Headers({ origin: "https://journal.example.com" }),
    );
    mocks.localJournalIsEnabled.mockReturnValue(false);
    mocks.invitationDeliveryIsEnabled.mockReturnValue(false);
    mocks.requestInvitation.mockResolvedValue({
      ok: true,
      message: "Private invitation requested.",
    });
    mocks.requireAccess.mockResolvedValue({
      mode: "authenticated",
      membershipId: "40000000-0000-4000-8000-000000000001",
      circleId: "20000000-0000-4000-8000-000000000001",
      personId: "30000000-0000-4000-8000-000000000001",
      role: "organizer",
    });
    mocks.rpc.mockResolvedValue({ data: circleId, error: null });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.createLocalCircle.mockResolvedValue({ circleId });
    mocks.writeCookie.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("stays on Account and invites into the new preview group", async () => {
    mocks.requireAccess.mockResolvedValueOnce({ mode: "preview" });

    await expect(createGroupAction({ name: "Cousins" })).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(mocks.writeCookie).toHaveBeenCalledWith("created", "Cousins");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/settings/family?inviteCircle=created&name=Cousins#invite",
    );
    expect(mocks.requestInvitation).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalledWith(
      expect.stringContaining("/family?circle="),
    );
  });

  it("stays on Account after a live Supabase create", async () => {
    await expect(createGroupAction({ name: "Cousins" })).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(mocks.rpc).toHaveBeenCalledWith("create_circle", {
      circle_name: "Cousins",
    });
    expect(mocks.writeCookie).toHaveBeenCalledWith(circleId);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/family");
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/settings/family?inviteCircle=${circleId}#invite`,
    );
  });

  it("stays on Account after a local journal create", async () => {
    mocks.localJournalIsEnabled.mockReturnValue(true);

    await expect(createGroupAction({ name: "Cousins" })).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(mocks.createLocalCircle).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "authenticated" }),
      "Cousins",
    );
    expect(mocks.writeCookie).toHaveBeenCalledWith(circleId);
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/settings/family?inviteCircle=${circleId}#invite`,
    );
  });

  it("rejects a missing name without creating a circle", async () => {
    await expect(createGroupAction({ name: "   " })).resolves.toEqual({
      ok: false,
      message: "A circle name is required.",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("invites who-else into the new circle and stays on Account", async () => {
    mocks.invitationDeliveryIsEnabled.mockReturnValue(true);

    await expect(
      createGroupAction({
        name: "All our days + Jordan",
        sourceCircleId: "20000000-0000-4000-8000-000000000001",
        whoElseName: ["Jordan"],
        whoElseEmail: ["jordan@example.com"],
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.rpc).toHaveBeenCalledWith("create_circle", {
      circle_name: "All our days + Jordan",
    });
    expect(mocks.requestInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        circleId: circleId,
        displayName: "Jordan",
        email: "jordan@example.com",
      }),
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/settings/family?inviteCircle=${circleId}&added=1`,
    );
  });

  it("rejects a start-from circle the actor does not belong to", async () => {
    await expect(
      createGroupAction({
        name: "Cousins",
        sourceCircleId: "20000000-0000-4000-8000-000000000099",
      }),
    ).resolves.toEqual({
      ok: false,
      message: "That circle could not be created.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
