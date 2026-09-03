// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createOAuthState,
  createOAuthStateToken,
  parseOAuthStateToken,
} from "./oauth-state";

describe("OAuth PKCE state", () => {
  beforeEach(() => {
    vi.stubEnv("OUR_DAYS_OAUTH_STATE_SECRET", "oauth-test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a signed Google or X state token", () => {
    const started = createOAuthState("x");
    expect(started.challenge).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(started.cookie.sameSite).toBe("lax");

    const parsed = parseOAuthStateToken(started.token);
    expect(parsed).toMatchObject({
      v: 1,
      provider: "x",
      verifier: started.verifier,
      nonce: started.nonce,
    });
  });

  it("rejects a tampered signature", () => {
    const token = createOAuthStateToken({
      v: 1,
      provider: "google",
      verifier: "verifier",
      nonce: "nonce",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(parseOAuthStateToken(`${token}x`)).toBeNull();
    expect(parseOAuthStateToken(undefined)).toBeNull();
  });
});
