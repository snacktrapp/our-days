import { describe, expect, it } from "vitest";
import { isFixtureDemoRouteEnabled } from "./fixture-demo-route-policy";

describe("fixture demo route policy", () => {
  it("allows the existing loopback design-preview environment", () => {
    expect(
      isFixtureDemoRouteEnabled({
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_ENVIRONMENT: "local",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      }),
    ).toBe(true);
  });

  it("allows only hosted Vercel Preview deployments", () => {
    expect(
      isFixtureDemoRouteEnabled({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "preview",
      }),
    ).toBe(true);
    expect(
      isFixtureDemoRouteEnabled({
        VERCEL: "1",
        VERCEL_ENV: "production",
        OUR_DAYS_ENVIRONMENT: "production",
      }),
    ).toBe(false);
    expect(
      isFixtureDemoRouteEnabled({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "production",
      }),
    ).toBe(false);
  });

  it("does not let Vercel design-preview flags widen access", () => {
    expect(
      isFixtureDemoRouteEnabled({
        VERCEL: "1",
        VERCEL_ENV: "production",
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
        OUR_DAYS_RESOURCE_MODE: "detached",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      }),
    ).toBe(false);
  });
});
