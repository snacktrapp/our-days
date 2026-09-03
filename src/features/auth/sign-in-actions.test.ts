// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHeaders: vi.fn(),
  createClient: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/headers", () => ({ headers: mocks.getHeaders }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));

import { requestSignInLink, verifySignInCode } from "./sign-in-actions";

const initialSignInActionState = { status: "idle" } as const;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("passwordless email sign-in actions", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    mocks.getHeaders.mockResolvedValue(
      new Headers({ origin: "https://journal.example.com" }),
    );
    mocks.limit.mockResolvedValue({ data: [{ circle_id: "circle-a" }] });
    mocks.select.mockReturnValue({ limit: mocks.limit });
    mocks.signInWithOtp.mockResolvedValue({ error: null });
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithOtp: mocks.signInWithOtp,
        verifyOtp: mocks.verifyOtp,
      },
      from: vi.fn(() => ({ select: mocks.select })),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("prevents a magic link from creating a user and returns generic copy", async () => {
    await expect(
      requestSignInLink(
        initialSignInActionState,
        form({ email: "  FAMILY@EXAMPLE.COM " }),
      ),
    ).resolves.toEqual({
      status: "sent",
      email: "family@example.com",
      message: "If this address has access, we sent a private sign-in link.",
    });

    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "family@example.com",
      options: {
        emailRedirectTo: "https://journal.example.com/auth/callback",
        shouldCreateUser: false,
      },
    });
  });

  it("does not become an account oracle when the provider rejects the address", async () => {
    mocks.signInWithOtp.mockRejectedValueOnce(new Error("unknown user"));

    await expect(
      requestSignInLink(
        initialSignInActionState,
        form({ email: "unknown@example.com" }),
      ),
    ).resolves.toEqual({
      status: "sent",
      email: "unknown@example.com",
      message: "If this address has access, we sent a private sign-in link.",
    });
  });

  it("fails closed before Auth on cross-origin requests", async () => {
    mocks.getHeaders.mockResolvedValueOnce(
      new Headers({ origin: "https://attacker.example" }),
    );

    await expect(
      requestSignInLink(
        initialSignInActionState,
        form({ email: "family@example.com" }),
      ),
    ).resolves.toMatchObject({ status: "denied" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("uses the Vercel Preview origin when SITE_URL is a copied staging host", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://our-days-staging.vercel.app");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "our-days-git-preview.vercel.app");
    mocks.getHeaders.mockResolvedValueOnce(
      new Headers({ origin: "https://our-days-git-preview.vercel.app" }),
    );

    await expect(
      requestSignInLink(
        initialSignInActionState,
        form({ email: "family@example.com" }),
      ),
    ).resolves.toMatchObject({ status: "sent" });
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "family@example.com",
      options: {
        emailRedirectTo:
          "https://our-days-git-preview.vercel.app/auth/callback",
        shouldCreateUser: false,
      },
    });
  });

  it("does not treat the request Origin as the expected origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    mocks.getHeaders.mockResolvedValueOnce(
      new Headers({ origin: "https://attacker.example" }),
    );

    await expect(
      requestSignInLink(
        initialSignInActionState,
        form({ email: "family@example.com" }),
      ),
    ).resolves.toMatchObject({ status: "denied" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("verifies one code and checks current RLS membership", async () => {
    await expect(
      verifySignInCode(
        initialSignInActionState,
        form({ email: "family@example.com", code: "123456" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: "family@example.com",
      token: "123456",
      type: "email",
    });
    expect(mocks.select).toHaveBeenCalledWith("circle_id");
    expect(mocks.redirect).toHaveBeenCalledWith("/family");
  });

  it("keeps a valid Auth identity without membership locked out", async () => {
    mocks.limit.mockResolvedValueOnce({ data: [] });

    await expect(
      verifySignInCode(
        initialSignInActionState,
        form({ email: "family@example.com", code: "123456" }),
      ),
    ).resolves.toEqual({
      status: "no-access",
      email: "family@example.com",
      message: "This account does not have access to a family circle.",
    });
  });
});
