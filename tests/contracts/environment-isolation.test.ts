import { describe, expect, it } from "vitest";
import { isLocalDesignPreviewEnvironment } from "../../config/design-preview-policy";
import {
  environmentForNextConfig,
  invitationDeliveryIsEnabled,
  mediaDeliveryIsEnabled,
  OurDaysEnvironmentError,
  validateOurDaysEnvironment,
} from "../../config/our-days-environment";

const productionRef = "aaaaaaaaaaaaaaaaaaaa";
const previewRef = "bbbbbbbbbbbbbbbbbbbb";
const proofRef = "zzzzzzzzzzzzzzzzzzzz";

const productionEnvironment = {
  CI: "true",
  VERCEL_ENV: "production",
  OUR_DAYS_ENVIRONMENT: "production",
  OUR_DAYS_RESOURCE_MODE: "supabase",
  NEXT_PUBLIC_SITE_URL: "https://journal.example.com",
  OUR_DAYS_PRODUCTION_SITE_ORIGIN: "https://journal.example.com",
  OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: productionRef,
  OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF: productionRef,
  OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS: proofRef,
  NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    "sb_publishable_environment_contract_fixture",
} as const;

function expectUnsafe(
  environment: Readonly<Record<string, string | undefined>>,
  issue: string,
) {
  expect(() => validateOurDaysEnvironment(environment)).toThrowError(
    expect.objectContaining<Partial<OurDaysEnvironmentError>>({
      name: "OurDaysEnvironmentError",
      issues: expect.arrayContaining([expect.stringContaining(issue)]),
    }),
  );
}

describe("Our Days environment isolation", () => {
  it("keeps invitation delivery disabled unless both the capability and Supabase mode are explicit", () => {
    expect(invitationDeliveryIsEnabled({})).toBe(false);
    expect(
      invitationDeliveryIsEnabled({
        OUR_DAYS_INVITATION_DELIVERY_MODE: "enabled",
        OUR_DAYS_RESOURCE_MODE: "detached",
      }),
    ).toBe(false);
    expect(
      invitationDeliveryIsEnabled({
        OUR_DAYS_INVITATION_DELIVERY_MODE: "enabled",
        OUR_DAYS_RESOURCE_MODE: "supabase",
      }),
    ).toBe(true);
  });

  it("rejects malformed or detached invitation-delivery activation", () => {
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_INVITATION_DELIVERY_MODE: "sometimes",
      },
      "must be disabled or enabled",
    );
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_INVITATION_DELIVERY_MODE: "enabled",
      },
      "requires supabase resource mode",
    );
  });

  it("keeps private media delivery disabled unless Supabase mode is explicit", () => {
    expect(mediaDeliveryIsEnabled({})).toBe(false);
    expect(
      mediaDeliveryIsEnabled({
        OUR_DAYS_MEDIA_DELIVERY_MODE: "enabled",
        OUR_DAYS_RESOURCE_MODE: "detached",
      }),
    ).toBe(false);
    expect(
      mediaDeliveryIsEnabled({
        OUR_DAYS_MEDIA_DELIVERY_MODE: "enabled",
        OUR_DAYS_RESOURCE_MODE: "supabase",
      }),
    ).toBe(true);
  });

  it("rejects malformed or detached private-media activation", () => {
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_MEDIA_DELIVERY_MODE: "sometimes",
      },
      "OUR_DAYS_MEDIA_DELIVERY_MODE must be disabled or enabled",
    );
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_MEDIA_DELIVERY_MODE: "enabled",
      },
      "OUR_DAYS_MEDIA_DELIVERY_MODE=enabled requires supabase resource mode",
    );
  });

  it("permits an explicit local detached build without resource credentials", () => {
    expect(
      validateOurDaysEnvironment({
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
      }),
    ).toEqual({
      identity: "local",
      resourceMode: "detached",
      siteOrigin: "http://127.0.0.1:3000",
    });
  });

  it("adds safe detached defaults only for unmanaged local commands", () => {
    expect(environmentForNextConfig({})).toMatchObject({
      OUR_DAYS_ENVIRONMENT: "local",
      OUR_DAYS_RESOURCE_MODE: "detached",
    });
    expect(environmentForNextConfig({ CI: "true" })).toEqual({ CI: "true" });
    expect(environmentForNextConfig({ VERCEL_ENV: "preview" })).toEqual({
      VERCEL_ENV: "preview",
    });
  });

  it("accepts a fully bound hosted Production environment", () => {
    expect(validateOurDaysEnvironment(productionEnvironment)).toEqual({
      identity: "production",
      resourceMode: "supabase",
      siteOrigin: "https://journal.example.com",
      supabaseProjectRef: productionRef,
    });
  });

  it("confines the explicit design-preview bypass to local detached loopback", () => {
    expect(
      validateOurDaysEnvironment({
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
      }),
    ).toMatchObject({ identity: "local", resourceMode: "detached" });

    expectUnsafe(
      {
        ...productionEnvironment,
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
      },
      "requires local identity",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "preview",
        OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: previewRef,
        NEXT_PUBLIC_SITE_URL: "https://preview.example.com",
        NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co`,
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
      },
      "requires local identity",
    );
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
      },
      "explicit loopback site origin",
    );
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "yes",
      },
      "must be true or false",
    );
  });

  it("fails the runtime design-preview policy closed for implicit or hosted development", () => {
    const safe = {
      NODE_ENV: "production",
      OUR_DAYS_ENVIRONMENT: "local",
      OUR_DAYS_RESOURCE_MODE: "detached",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
    } as const;
    expect(isLocalDesignPreviewEnvironment(safe)).toBe(true);
    expect(
      isLocalDesignPreviewEnvironment({
        NODE_ENV: "development",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
      }),
    ).toBe(false);
    expect(
      isLocalDesignPreviewEnvironment({
        ...safe,
        NEXT_PUBLIC_SITE_URL: "http://0.0.0.0:3100",
      }),
    ).toBe(false);
    expect(
      isLocalDesignPreviewEnvironment({
        ...safe,
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "preview",
        NEXT_PUBLIC_SITE_URL: "https://preview.example.com",
      }),
    ).toBe(false);
    expect(
      isLocalDesignPreviewEnvironment({
        ...safe,
        OUR_DAYS_RESOURCE_MODE: "supabase",
      }),
    ).toBe(false);
    expect(
      isLocalDesignPreviewEnvironment({
        ...safe,
        NEXT_PUBLIC_SITE_URL: "http://localhost:3100/family",
      }),
    ).toBe(false);
  });

  it("accepts local Supabase only with an explicit Proof denylist", () => {
    expect(
      validateOurDaysEnvironment({
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "supabase",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: "local",
        OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS: proofRef,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          "sb_publishable_local_contract_fixture",
      }),
    ).toMatchObject({ identity: "local", supabaseProjectRef: "local" });
  });

  it("accepts a local Supabase subdomain through the shared origin resolver", () => {
    expect(
      validateOurDaysEnvironment({
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "supabase",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: "local",
        OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS: proofRef,
        NEXT_PUBLIC_SUPABASE_URL: "http://journal.localhost:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          "sb_publishable_local_contract_fixture",
      }),
    ).toMatchObject({ identity: "local", supabaseProjectRef: "local" });
  });

  it("accepts Preview only when it is isolated from Production", () => {
    expect(
      validateOurDaysEnvironment({
        ...productionEnvironment,
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "preview",
        OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: previewRef,
        NEXT_PUBLIC_SITE_URL: "https://preview.example.com",
        NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co`,
      }),
    ).toMatchObject({ identity: "preview", supabaseProjectRef: previewRef });
  });

  it("rejects Preview using the Production origin and Production using another origin", () => {
    expectUnsafe(
      {
        ...productionEnvironment,
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "preview",
        OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: previewRef,
        NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co`,
      },
      "Preview must not use the Production site origin",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        NEXT_PUBLIC_SITE_URL: "https://other.example.com",
      },
      "Production must use its declared Production site origin",
    );
  });

  it("rejects missing or contradictory hosted identity", () => {
    expectUnsafe(
      { CI: "true", OUR_DAYS_RESOURCE_MODE: "detached" },
      "OUR_DAYS_ENVIRONMENT is required",
    );
    expectUnsafe(
      { ...productionEnvironment, OUR_DAYS_ENVIRONMENT: "preview" },
      "must match VERCEL_ENV",
    );
    expectUnsafe(
      { ...productionEnvironment, OUR_DAYS_RESOURCE_MODE: "detached" },
      "detached resource mode",
    );
  });

  it("rejects project URL mismatch, Preview-to-Production wiring, and Proof refs", () => {
    expectUnsafe(
      {
        ...productionEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co`,
      },
      "does not match",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "preview",
      },
      "Preview must not use",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: proofRef,
        OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF: proofRef,
        NEXT_PUBLIC_SUPABASE_URL: `https://${proofRef}.supabase.co`,
      },
      "forbidden Proof resource",
    );
  });

  it("rejects a hosted local environment wired to Production", () => {
    expectUnsafe(
      {
        ...productionEnvironment,
        CI: undefined,
        VERCEL_ENV: undefined,
        OUR_DAYS_ENVIRONMENT: "local",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      },
      "local development must not use",
    );
  });

  it("rejects partial, legacy-key, and malformed Supabase configuration", () => {
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "supabase",
      },
      "NEXT_PUBLIC_SUPABASE_URL is required",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "legacy-anon-key",
      },
      "current publishable key",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co/rest/v1`,
      },
      "must be a base origin",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co:444`,
      },
      "must be the HTTPS base origin",
    );
  });

  it("rejects insecure or non-origin hosted site URLs", () => {
    expectUnsafe(
      {
        ...productionEnvironment,
        NEXT_PUBLIC_SITE_URL: "http://journal.example.com",
      },
      "must use HTTPS",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        NEXT_PUBLIC_SITE_URL:
          "https://journal.example.com/callback?next=/family",
      },
      "must be an origin",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        NEXT_PUBLIC_SITE_URL: "https://*.example.com",
      },
      "must be an origin",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        NEXT_PUBLIC_SITE_URL: "https://localhost",
        OUR_DAYS_PRODUCTION_SITE_ORIGIN: "https://localhost",
      },
      "must not use a loopback host",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        NEXT_PUBLIC_SITE_URL: "https://journal.localhost",
        OUR_DAYS_PRODUCTION_SITE_ORIGIN: "https://journal.localhost",
      },
      "must not use a loopback host",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        NEXT_PUBLIC_SITE_URL: "https://192.0.2.10",
        OUR_DAYS_PRODUCTION_SITE_ORIGIN: "https://192.0.2.10",
      },
      "must use a DNS hostname",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "preview",
        OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: previewRef,
        NEXT_PUBLIC_SITE_URL: "https://journal.example.com.",
        NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co`,
      },
      "must be an origin",
    );
  });

  it.each([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_ANON_KEY",
    "SUPABASE_URL",
    "SB_SECRET_KEY",
    "NEXT_PUBLIC_SUPABASE_SECRET_KEY",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_JWT_PRIVATE_KEY",
    "SUPABASE_PASSWORD",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_DB_URL",
    "POSTGRES_URL",
    "DATABASE_URL",
    "DIRECT_URL",
    "NEXT_PUBLIC_DATABASE_URL",
    "NEXT_PUBLIC_POSTGRES_PASSWORD",
    "OUR_DAYS_SUPABASE_DB_URL",
    "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
    "JWT_PRIVATE_KEY",
    "JWT_SIGNING_KEY",
    "PGHOST",
    "PGHOSTADDR",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSFILE",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGSSLCERT",
    "PGSSLCRL",
    "PGSSLKEY",
    "PGSSLROOTCERT",
    "PGPASSWORD",
  ])(
    "rejects privileged web credential %s without echoing its value",
    (name) => {
      const secret = "do-not-echo-this-sensitive-value";
      try {
        validateOurDaysEnvironment({
          ...productionEnvironment,
          [name]: secret,
        });
        throw new Error("expected environment validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(OurDaysEnvironmentError);
        expect(String(error)).toContain(name);
        expect(String(error)).not.toContain(secret);
      }
    },
  );

  it.each([
    ["MYSTERY_TOKEN", ["sb", "secret", "synthetic_secret_fixture"].join("_")],
    [
      "MYSTERY_MANAGEMENT_TOKEN",
      ["sbp", "syntheticmanagementfixture"].join("_"),
    ],
    [
      "MYSTERY_DATABASE",
      ["postgresql", "://user:password@db.invalid:5432/db"].join(""),
    ],
    [
      "MYSTERY_PRIVATE_KEY",
      ["-----BEGIN", " PRIVATE KEY-----\nfixture"].join(""),
    ],
    [
      "MYSTERY_JWT",
      `e30.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.fixture`,
    ],
  ])(
    "rejects privileged value patterns in an arbitrary variable %s without echoing the value",
    (name, secret) => {
      try {
        validateOurDaysEnvironment({
          ...productionEnvironment,
          [name]: secret,
        });
        throw new Error("expected environment validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(OurDaysEnvironmentError);
        expect(String(error)).toContain(name);
        expect(String(error)).not.toContain(secret);
      }
    },
  );

  it("rejects legacy Supabase aliases even in detached mode", () => {
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        SUPABASE_URL: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co",
        SUPABASE_ANON_KEY: "legacy-anon-fixture",
      },
      "SUPABASE_ANON_KEY, SUPABASE_URL",
    );
  });
});
