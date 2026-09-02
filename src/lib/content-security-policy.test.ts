import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "./content-security-policy";

const nonce = "0123456789abcdefghijklmnopqrstuv";

describe("content security policy", () => {
  it("builds a strict production policy without inline or eval escapes", () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      development: false,
    });

    expect(policy).toContain(
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    );
    expect(policy).toContain(`style-src 'self' 'nonce-${nonce}'`);
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("style-src-attr 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("allows only the configured Supabase HTTP and websocket origins", () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      development: false,
      supabaseUrl: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    });

    expect(policy).toContain(
      "connect-src 'self' blob: https://aaaaaaaaaaaaaaaaaaaa.supabase.co https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co wss://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    );
    expect(policy).toContain(
      "img-src 'self' blob: data: https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    );
    expect(policy).toContain(
      "media-src 'self' blob: https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    );
    expect(policy).not.toContain("*.supabase.co");
    expect(policy).not.toContain("*.storage.supabase.co");
  });

  it("does not upgrade loopback HTTP production servers to HTTPS", () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      development: false,
      siteUrl: "http://127.0.0.1:3100",
    });

    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("permits only development tooling escapes and local Supabase", () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      development: true,
      supabaseUrl: "http://127.0.0.1:54321",
    });

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain(
      "connect-src 'self' blob: ws: http://127.0.0.1:54321 ws://127.0.0.1:54321",
    );
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("uses the same local-subdomain origin contract as environment validation", () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      development: false,
      supabaseUrl: "http://journal.localhost:54321",
    });

    expect(policy).toContain(
      "connect-src 'self' blob: http://journal.localhost:54321 ws://journal.localhost:54321",
    );
  });

  it.each([
    { nonce: "short", development: false },
    {
      nonce,
      development: false,
      supabaseUrl: "https://user:secret@example.com",
    },
    {
      nonce,
      development: false,
      supabaseUrl: "https://example.com/rest/v1",
    },
    {
      nonce,
      development: false,
      supabaseUrl: "http://example.com",
    },
    {
      nonce,
      development: false,
      supabaseUrl: "https://evil.example",
    },
    {
      nonce,
      development: false,
      supabaseUrl: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co:444",
    },
  ])("rejects unsafe policy input %#", (options) => {
    expect(() => buildContentSecurityPolicy(options)).toThrow();
  });
});
