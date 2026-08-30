import { describe, expect, it } from "vitest";
import { resolveMetadataBase } from "./metadata-base.server";

describe("metadata environment integration", () => {
  it("uses the normalized loopback origin accepted by the shared environment contract", () => {
    expect(
      resolveMetadataBase({
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
      }).origin,
    ).toBe("http://127.0.0.1:3000");
  });

  it("uses the safe local default only for an unmanaged local process", () => {
    expect(resolveMetadataBase({}).origin).toBe("http://localhost:3000");
  });

  it("propagates fail-closed managed environment errors", () => {
    expect(() => resolveMetadataBase({ CI: "true" })).toThrow(
      "OUR_DAYS_ENVIRONMENT is required",
    );
  });
});
