import { describe, expect, it } from "vitest";
import {
  hostedVercelClientRuntime,
  readOptionalSupabasePublicConfig,
  readSupabasePublicConfig,
} from "./public-config";

describe("Supabase public configuration", () => {
  it("returns only the URL and publishable key", () => {
    expect(
      readSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_value",
        UNRELATED_VALUE: "ignored",
      }),
    ).toEqual({
      url: "http://127.0.0.1:54321",
      publishableKey: "sb_publishable_test_value",
    });
  });

  it("allows detached mode only when both values are absent", () => {
    expect(readOptionalSupabasePublicConfig({})).toBeNull();
    expect(() =>
      readOptionalSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toThrow("Supabase public configuration is unavailable");
  });

  it("treats only hosted Vercel preview and production as the public client runtime", () => {
    const prior = process.env.NEXT_PUBLIC_VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_VERCEL_ENV;
    expect(hostedVercelClientRuntime()).toBe(false);
    process.env.NEXT_PUBLIC_VERCEL_ENV = "preview";
    expect(hostedVercelClientRuntime()).toBe(true);
    process.env.NEXT_PUBLIC_VERCEL_ENV = "production";
    expect(hostedVercelClientRuntime()).toBe(true);
    process.env.NEXT_PUBLIC_VERCEL_ENV = "development";
    expect(hostedVercelClientRuntime()).toBe(false);
    if (prior === undefined) delete process.env.NEXT_PUBLIC_VERCEL_ENV;
    else process.env.NEXT_PUBLIC_VERCEL_ENV = prior;
  });
});
