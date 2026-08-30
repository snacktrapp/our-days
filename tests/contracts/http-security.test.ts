import { describe, expect, it } from "vitest";
import { httpSecurityHeaders } from "../../config/http-security";

describe("static HTTP security headers", () => {
  it.each(["local", "preview", "production"] as const)(
    "keeps the shared isolation baseline in %s",
    (identity) => {
      expect(httpSecurityHeaders(identity)).toEqual(
        expect.arrayContaining([
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ]),
      );
    },
  );

  it("emits HSTS only for the exact Production identity", () => {
    const hsts = {
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    };

    expect(httpSecurityHeaders("production")).toContainEqual(hsts);
    expect(httpSecurityHeaders("preview")).not.toContainEqual(hsts);
    expect(httpSecurityHeaders("local")).not.toContainEqual(hsts);
  });
});
