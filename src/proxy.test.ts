// @vitest-environment node

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { access } from "node:fs/promises";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

describe("security proxy", () => {
  it("issues a fresh strict policy and ignores attacker nonce headers", () => {
    const request = () =>
      new NextRequest("https://journal.example.com/family", {
        headers: {
          "content-security-policy": "script-src * 'unsafe-inline'",
          "x-nonce": "attacker-controlled-nonce",
        },
      });
    const first = proxy(request());
    const second = proxy(request());
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
