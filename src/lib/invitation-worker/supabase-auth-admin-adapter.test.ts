import { describe, expect, it, vi } from "vitest";
import {
  InvitationAuthAdminAdapterError,
  SupabaseInvitationAuthAdminAdapter,
} from "./supabase-auth-admin-adapter";

const serviceRoleKey = "local-worker-only-service-role-key-1234567890";
const email = "new.relative@example.test";
const userId = "b2000000-0000-4000-8000-000000000001";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function adapter(fetch: typeof globalThis.fetch) {
  return new SupabaseInvitationAuthAdminAdapter({
    projectUrl: "http://127.0.0.1:54321",
    serviceRoleKey,
    fetch,
  });
}

describe("Supabase invitation Auth Admin adapter", () => {
  it("finds one exact normalized address without returning unrelated users", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response({
        users: [
          {
            id: "b2000000-0000-4000-8000-000000000002",
            email: "someone.else@example.test",
            email_confirmed_at: null,
          },
          {
            id: userId,
            email,
            email_confirmed_at: "2026-08-31T19:00:00.000Z",
          },
        ],
      }),
    );
    await expect(adapter(fetch).findByNormalizedEmail(email)).resolves.toEqual({
      id: userId,
      email,
      emailConfirmedAt: "2026-08-31T19:00:00.000Z",
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:54321/auth/v1/admin/users?page=1&per_page=1000",
      expect.objectContaining({
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
        },
        method: "GET",
      }),
    );
  });

  it("returns null only after a complete final page", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response({ users: [] }),
    );
    await expect(
      adapter(fetch).findByNormalizedEmail(email),
    ).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("continues past a full page before returning the exact user", async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
      id: `b2${String(index).padStart(6, "0")}-0000-4000-8000-000000000001`,
      email: `other-${index}@example.test`,
      email_confirmed_at: null,
    }));
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const page = new URL(String(input)).searchParams.get("page");
      return response({
        users:
          page === "1"
            ? firstPage
            : [{ id: userId, email, email_confirmed_at: null }],
      });
    });
    await expect(adapter(fetch).findByNormalizedEmail(email)).resolves.toEqual({
      id: userId,
      email,
      emailConfirmedAt: null,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("creates an exact unconfirmed account through the admin invite endpoint", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response({ id: userId, email, email_confirmed_at: null }),
    );
    await expect(adapter(fetch).createUnconfirmedUser(email)).resolves.toEqual({
      id: userId,
      email,
      emailConfirmedAt: null,
    });
    const [, init] = fetch.mock.calls[0] ?? [];
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:54321/auth/v1/invite",
    );
    expect(JSON.parse(String(init?.body))).toEqual({ email });
    expect(String(init?.body)).not.toMatch(/redirect|password|token/iu);
  });

  it("rejects a create response that marks the new account confirmed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response({
        id: userId,
        email,
        email_confirmed_at: "2026-08-31T19:00:00.000Z",
      }),
    );
    await expect(
      adapter(fetch).createUnconfirmedUser(email),
    ).rejects.toBeInstanceOf(InvitationAuthAdminAdapterError);
  });

  it("renews an admin invitation for the same existing unconfirmed identity", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response({ id: userId, email, email_confirmed_at: null }),
    );
    await expect(
      adapter(fetch).sendAuthenticationCode({
        id: userId,
        email,
        emailConfirmedAt: null,
      }),
    ).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:54321/auth/v1/invite");
    expect(JSON.parse(String(init?.body))).toEqual({ email });
  });

  it("sends an existing confirmed identity a no-create passwordless code", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response({}));
    await expect(
      adapter(fetch).sendAuthenticationCode({
        id: userId,
        email,
        emailConfirmedAt: "2026-08-31T19:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:54321/auth/v1/otp");
    expect(JSON.parse(String(init?.body))).toEqual({
      email,
      create_user: false,
    });
  });

  it("rejects an unconfirmed renewal response for a different identity", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response({
        id: "b2000000-0000-4000-8000-000000000002",
        email,
        email_confirmed_at: null,
      }),
    );
    await expect(
      adapter(fetch).sendAuthenticationCode({
        id: userId,
        email,
        emailConfirmedAt: null,
      }),
    ).rejects.toBeInstanceOf(InvitationAuthAdminAdapterError);
  });

  it("fails closed on duplicate exact-address identities", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response({
        users: [
          { id: userId, email, email_confirmed_at: null },
          {
            id: "b2000000-0000-4000-8000-000000000002",
            email,
            email_confirmed_at: null,
          },
        ],
      }),
    );
    await expect(
      adapter(fetch).findByNormalizedEmail(email),
    ).rejects.toBeInstanceOf(InvitationAuthAdminAdapterError);
  });

  it.each([
    "NEW.Relative@example.test",
    "new.relative@example.test ",
    "not-an-email",
    "new\u0000.relative@example.test",
  ])(
    "rejects unsafe or non-normalized address %j before fetch",
    async (value) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      await expect(
        adapter(fetch).findByNormalizedEmail(value),
      ).rejects.toBeInstanceOf(InvitationAuthAdminAdapterError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "http://example.com",
    "ftp://127.0.0.1:54321",
    "https://example.com/project/path",
    "https://user:password@example.com",
    "https://example.com?secret=value",
  ])("rejects unsafe project origin %s", (projectUrl) => {
    expect(
      () =>
        new SupabaseInvitationAuthAdminAdapter({
          projectUrl,
          serviceRoleKey,
          fetch: vi.fn<typeof globalThis.fetch>(),
        }),
    ).toThrow(InvitationAuthAdminAdapterError);
  });

  it.each([
    ["HTTP denial", response({ message: email }, 403)],
    ["malformed body", response({ users: "not-an-array" })],
  ])("reconstructs %s as a content-free error", async (_label, result) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => result);
    const error = await adapter(fetch)
      .findByNormalizedEmail(email)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvitationAuthAdminAdapterError);
    expect(String(error)).not.toContain(email);
  });
});
