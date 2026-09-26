// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCachedJwks,
  documentAuthBudgetMs,
  isDocumentGet,
  labAuthMustBlockDocument,
  labAuthNetworkDelay,
  readCachedJwks,
  readDocumentAccessToken,
  refreshJwks,
} from "./document-auth";

function jwt(header: unknown, payload: unknown) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode(header)}.${encode(payload)}.${encode("sig")}`;
}

function requestWithSession(token: string, expSeconds: number) {
  const session = Buffer.from(
    JSON.stringify({
      access_token: token,
      refresh_token: "refresh",
      expires_at: expSeconds,
    }),
  ).toString("base64url");
  return new NextRequest("https://journal.example.com/family", {
    headers: { cookie: `sb-project-auth-token=base64-${session}` },
  });
}

describe("document auth budget", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearCachedJwks();
  });

  it("treats a journal HTML GET as a document and leaves APIs and flights on the full auth path", () => {
    expect(
      isDocumentGet(
        new NextRequest("https://journal.example.com/family", {
          headers: { accept: "text/html" },
        }),
      ),
    ).toBe(true);
    expect(
      isDocumentGet(
        new NextRequest("https://journal.example.com/api/media/moments/1", {
          headers: { accept: "text/html" },
        }),
      ),
    ).toBe(false);
    expect(
      isDocumentGet(
        new NextRequest("https://journal.example.com/family", {
          method: "POST",
          headers: { accept: "text/html" },
        }),
      ),
    ).toBe(false);
    expect(
      isDocumentGet(
        new NextRequest("https://journal.example.com/family", {
          headers: { accept: "text/x-component", rsc: "1" },
        }),
      ),
    ).toBe(false);
    expect(
      isDocumentGet(
        new NextRequest("https://journal.example.com/family?_rsc=abc", {
          headers: {
            accept: "text/html",
            "next-router-prefetch": "1",
            "next-router-state-tree": "%5B%5D",
          },
        }),
      ),
    ).toBe(false);
  });

  it("keeps a short budget for a fresh asymmetric session and waits in full when a refresh may write cookies", () => {
    const future = Math.floor(Date.now() / 1000) + 60 * 60;
    const soon = Math.floor(Date.now() / 1000) + 30;
    const fresh = requestWithSession(
      jwt({ alg: "ES256", kid: "prod-key" }, { exp: future }),
      future,
    );
    const expiring = requestWithSession(
      jwt({ alg: "ES256", kid: "prod-key" }, { exp: soon }),
      soon,
    );
    const symmetric = requestWithSession(
      jwt({ alg: "HS256" }, { exp: future }),
      future,
    );
    expect(documentAuthBudgetMs(fresh)).toBe(200);
    expect(documentAuthBudgetMs(expiring)).toBeNull();
    expect(documentAuthBudgetMs(symmetric)).toBeNull();
    expect(
      documentAuthBudgetMs(
        new NextRequest("https://journal.example.com/family", {
          headers: { cookie: "sb-project-auth-token=not-a-session" },
        }),
      ),
    ).toBeNull();
    expect(
      documentAuthBudgetMs(
        new NextRequest("https://journal.example.com/family"),
      ),
    ).toBe(200);
    expect(readDocumentAccessToken(fresh)?.split(".").length).toBe(3);
  });

  it("reassembles chunked session cookies without treating them as a document secret", () => {
    const token = jwt({ alg: "ES256", kid: "prod-key" }, { exp: 10 });
    const session = `base64-${Buffer.from(JSON.stringify({ access_token: token })).toString("base64url")}`;
    const request = new NextRequest("https://journal.example.com/family", {
      headers: {
        cookie: `sb-project-auth-token.0=${session.slice(0, 12)}; sb-project-auth-token.1=${session.slice(12)}`,
      },
    });
    expect(readDocumentAccessToken(request)).toBe(token);
  });

  it("caches JWKS past a single request and ignores a failed refresh", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            keys: [{ kid: "prod-key", kty: "EC", alg: "ES256" }],
          }),
        ),
      )
      .mockRejectedValueOnce(new Error("stalled"));
    vi.stubGlobal("fetch", fetchMock);
    await refreshJwks("https://project.supabase.co");
    expect(readCachedJwks("https://project.supabase.co")).toEqual([
      { kid: "prod-key", kty: "EC", alg: "ES256" },
    ]);
    await refreshJwks("https://project.supabase.co");
    expect(readCachedJwks("https://project.supabase.co")).toEqual([
      { kid: "prod-key", kty: "EC", alg: "ES256" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/auth/v1/.well-known/jwks.json", "https://project.supabase.co"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("simulates a stalled auth network only when the lab explicitly blocks the document", async () => {
    vi.stubEnv("OUR_DAYS_LAB", "1");
    vi.stubEnv("OUR_DAYS_LAB_AUTH_DELAY_MS", "30");
    expect(labAuthMustBlockDocument()).toBe(false);
    const open = Date.now();
    await labAuthNetworkDelay();
    expect(Date.now() - open).toBeLessThan(20);

    vi.stubEnv("OUR_DAYS_LAB_AUTH_BLOCKING", "1");
    expect(labAuthMustBlockDocument()).toBe(true);
    const blocked = Date.now();
    await labAuthNetworkDelay();
    expect(Date.now() - blocked).toBeGreaterThanOrEqual(20);
  });
});
