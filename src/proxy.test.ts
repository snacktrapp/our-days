// @vitest-environment node

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { access } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: supabaseMocks.createServerClient,
}));

import { config, proxy } from "./proxy";

type ProxyCookie = Readonly<{
  name: string;
  value: string;
  options: Readonly<{
    path?: string;
    sameSite?: "lax" | "strict" | "none";
    secure?: boolean;
  }>;
}>;

type ProxyCookieAdapter = Readonly<{
  getAll(): readonly Readonly<{ name: string; value: string }>[];
  setAll(
    cookies: readonly ProxyCookie[],
    headers: Readonly<Record<string, string>>,
  ): void;
}>;

describe("security proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("issues a fresh strict policy and ignores attacker nonce headers", async () => {
    const request = () =>
      new NextRequest("https://journal.example.com/family", {
        headers: {
          "content-security-policy": "script-src * 'unsafe-inline'",
          "x-nonce": "attacker-controlled-nonce",
        },
      });
    const first = await proxy(request());
    const second = await proxy(request());
    const firstPolicy = first.headers.get("content-security-policy") ?? "";
    const secondPolicy = second.headers.get("content-security-policy") ?? "";
    const firstNonce = firstPolicy.match(/'nonce-([^']+)'/u)?.[1];
    const secondNonce = secondPolicy.match(/'nonce-([^']+)'/u)?.[1];

    expect(firstNonce).toBeTruthy();
    expect(secondNonce).toBeTruthy();
    expect(firstNonce).not.toBe(secondNonce);
    expect(firstPolicy).not.toContain("attacker-controlled-nonce");
    expect(firstPolicy).not.toContain("'unsafe-inline'");
    expect(first.headers.get("x-nonce")).toBeNull();
  });

  it("preserves every refreshed cookie and private cache header beside the nonce policy", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");

    let cookieAdapter: ProxyCookieAdapter | undefined;
    const getClaims = vi.fn(async () => {
      cookieAdapter?.setAll(
        [
          {
            name: "sb-local-auth-token.0",
            value: "refreshed-first-chunk",
            options: { path: "/", sameSite: "lax" },
          },
          {
            name: "sb-local-auth-token.1",
            value: "refreshed-second-chunk",
            options: { path: "/", sameSite: "lax", secure: true },
          },
        ],
        {
          "Cache-Control":
            "private, no-cache, no-store, must-revalidate, max-age=0",
          Expires: "0",
          Pragma: "no-cache",
        },
      );
      return { data: { claims: { sub: "user-a" } }, error: null };
    });
    supabaseMocks.createServerClient.mockImplementation(
      (_url: string, _publishableKey: string, options: unknown) => {
        cookieAdapter = (options as { cookies: ProxyCookieAdapter }).cookies;
        return { auth: { getClaims } };
      },
    );

    const response = await proxy(
      new NextRequest("https://journal.example.com/family", {
        headers: { cookie: "existing-cookie=kept" },
      }),
    );

    expect(supabaseMocks.createServerClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "publishable-test-key",
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
    expect(cookieAdapter?.getAll()).toEqual([
      { name: "existing-cookie", value: "kept" },
      { name: "sb-local-auth-token.0", value: "refreshed-first-chunk" },
      { name: "sb-local-auth-token.1", value: "refreshed-second-chunk" },
    ]);
    expect(getClaims).toHaveBeenCalledOnce();

    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    expect(setCookies[0]).toContain(
      "sb-local-auth-token.0=refreshed-first-chunk",
    );
    expect(setCookies[1]).toContain(
      "sb-local-auth-token.1=refreshed-second-chunk",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, must-revalidate, max-age=0",
    );
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "existing-cookie=kept",
    );
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "sb-local-auth-token.0=refreshed-first-chunk",
    );
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "sb-local-auth-token.1=refreshed-second-chunk",
    );
  });

  it.each([
    ["/", true],
    ["/family", true],
    ["/people/molly", true],
    ["/api/future-mutation", true],
    ["/_next/static/chunks/app.js", true],
    ["/_next/image?url=%2Fsample-family.jpg", true],
    ["/sw.js", false],
    ["/manifest.webmanifest", true],
    ["/robots.txt", true],
    ["/sample-family.jpg", false],
    ["/favicon.ico", true],
    ["/_next/static", true],
    ["/_next/image/evil", true],
    ["/_next/static-near-miss/chunk.js", true],
    ["/_next/image-evil?url=%2Fsample-family.jpg", true],
    ["/sw.js-anything", true],
    ["/manifest.webmanifest-x", true],
    ["/robots.txtfoo", true],
    ["/sample-family.jpg/extra", true],
  ])("matches request path %s = %s", (url, expected) => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url,
      }),
    ).toBe(expected);
  });

  it.each([
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "icon-1024.png",
    "og.png",
    "sample-family.jpg",
    "sw.js",
  ])("excludes only a present inert public asset: %s", async (filename) => {
    await expect(
      access(new URL(`../public/${filename}`, import.meta.url)),
    ).resolves.toBeUndefined();
  });
});
