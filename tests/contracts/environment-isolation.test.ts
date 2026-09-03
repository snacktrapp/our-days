import { describe, expect, it } from "vitest";
import { isDesignPreviewEnvironment } from "../../config/design-preview-policy";
import {
  environmentForNextConfig,
  invitationDeliveryIsEnabled,
  journalPersistenceIsConnected,
  localJournalIsEnabled,
  mediaDeliveryIsEnabled,
  photoPostingIsEnabled,
  resolvedSiteOrigin,
  supabaseResourceIsActive,
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
  it("enables invitation delivery for hosted Vercel unless it is explicitly disabled", () => {
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
    expect(
      invitationDeliveryIsEnabled({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        OUR_DAYS_RESOURCE_MODE: "supabase",
      }),
    ).toBe(true);
    expect(
      invitationDeliveryIsEnabled({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        OUR_DAYS_RESOURCE_MODE: "supabase",
        OUR_DAYS_INVITATION_DELIVERY_MODE: "disabled",
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

  it("keeps photo posting disabled unless Supabase mode is explicit", () => {
    expect(photoPostingIsEnabled({})).toBe(false);
    expect(
      photoPostingIsEnabled({
        OUR_DAYS_PHOTO_POSTING_MODE: "enabled",
        OUR_DAYS_RESOURCE_MODE: "detached",
      }),
    ).toBe(false);
    expect(
      photoPostingIsEnabled({
        OUR_DAYS_PHOTO_POSTING_MODE: "enabled",
        OUR_DAYS_RESOURCE_MODE: "supabase",
      }),
    ).toBe(true);
    expect(
      photoPostingIsEnabled({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        OUR_DAYS_RESOURCE_MODE: "supabase",
      }),
    ).toBe(true);
    expect(
      photoPostingIsEnabled({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        OUR_DAYS_RESOURCE_MODE: "supabase",
        OUR_DAYS_PHOTO_POSTING_MODE: "disabled",
      }),
    ).toBe(false);
  });

  it("rejects malformed or detached photo-posting activation", () => {
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_PHOTO_POSTING_MODE: "sometimes",
      },
      "OUR_DAYS_PHOTO_POSTING_MODE must be disabled or enabled",
    );
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_PHOTO_POSTING_MODE: "enabled",
      },
      "OUR_DAYS_PHOTO_POSTING_MODE=enabled requires supabase resource mode",
    );
  });

  it("keeps the local journal off unless detached local mode is explicit", () => {
    expect(localJournalIsEnabled({})).toBe(false);
    expect(
      localJournalIsEnabled({
        OUR_DAYS_LOCAL_JOURNAL_MODE: "enabled",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
      }),
    ).toBe(false);
    expect(
      localJournalIsEnabled({
        OUR_DAYS_LOCAL_JOURNAL_MODE: "enabled",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "false",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
      }),
    ).toBe(true);
    expect(
      localJournalIsEnabled({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        OUR_DAYS_LOCAL_JOURNAL_MODE: "enabled",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "false",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
      }),
    ).toBe(false);
    expect(
      journalPersistenceIsConnected({
        OUR_DAYS_RESOURCE_MODE: "supabase",
      }),
    ).toBe(true);
    expect(supabaseResourceIsActive({})).toBe(false);
  });

  it("rejects a hosted or Supabase local-journal activation", () => {
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_LOCAL_JOURNAL_MODE: "sometimes",
      },
      "OUR_DAYS_LOCAL_JOURNAL_MODE must be disabled or enabled",
    );
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "production",
        OUR_DAYS_RESOURCE_MODE: "supabase",
        OUR_DAYS_LOCAL_JOURNAL_MODE: "enabled",
        NEXT_PUBLIC_SITE_URL: "https://journal.example.com",
        OUR_DAYS_PRODUCTION_SITE_ORIGIN: "https://journal.example.com",
        OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: productionRef,
        OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF: productionRef,
        NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co`,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          "sb_publishable_environment_contract_fixture",
      },
      "requires detached resource mode",
    );
    expectUnsafe(
      {
        VERCEL: "1",
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_LOCAL_JOURNAL_MODE: "enabled",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
      },
      "cannot be enabled on Vercel",
    );
  });

  it("treats Google and X OAuth secrets as optional complete pairs", () => {
    expect(
      validateOurDaysEnvironment({
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
        OUR_DAYS_GOOGLE_CLIENT_ID: "google-id.apps.googleusercontent.com",
        OUR_DAYS_GOOGLE_CLIENT_SECRET: "google-secret",
        OUR_DAYS_X_CLIENT_ID: "x-id",
        OUR_DAYS_X_CLIENT_SECRET: "x-secret",
      }),
    ).toMatchObject({
      identity: "local",
      resourceMode: "detached",
    });
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
        OUR_DAYS_GOOGLE_CLIENT_ID: "google-id.apps.googleusercontent.com",
      },
      "OUR_DAYS_GOOGLE_CLIENT_SECRET is required when OUR_DAYS_GOOGLE_CLIENT_ID is set",
    );
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
        OUR_DAYS_X_CLIENT_SECRET: "x-secret",
      },
      "OUR_DAYS_X_CLIENT_ID is required when OUR_DAYS_X_CLIENT_SECRET is set",
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

  it("confines the explicit design-preview bypass to local loopback or Vercel Preview", () => {
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
      "requires an explicit local loopback or Vercel Preview identity",
    );
    expect(
      validateOurDaysEnvironment({
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "preview",
        OUR_DAYS_RESOURCE_MODE: "detached",
        NEXT_PUBLIC_SITE_URL: "https://preview.example.com",
        OUR_DAYS_PRODUCTION_SITE_ORIGIN: "https://journal.example.com",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
      }),
    ).toMatchObject({ identity: "preview", resourceMode: "detached" });
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "preview",
        OUR_DAYS_RESOURCE_MODE: "detached",
        NEXT_PUBLIC_SITE_URL: "https://preview.example.com",
        OUR_DAYS_PRODUCTION_SITE_ORIGIN: "https://journal.example.com",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
      },
      "requires an explicit local loopback or Vercel Preview identity",
    );
    expectUnsafe(
      {
        OUR_DAYS_ENVIRONMENT: "local",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
      },
      "explicit local loopback or Vercel Preview identity",
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
    expect(isDesignPreviewEnvironment(safe)).toBe(true);
    expect(
      isDesignPreviewEnvironment({
        NODE_ENV: "development",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
      }),
    ).toBe(false);
    expect(
      isDesignPreviewEnvironment({
        ...safe,
        NEXT_PUBLIC_SITE_URL: "http://0.0.0.0:3100",
      }),
    ).toBe(false);
    expect(
      isDesignPreviewEnvironment({
        ...safe,
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "preview",
        NEXT_PUBLIC_SITE_URL: "https://preview.example.com",
      }),
    ).toBe(true);
    expect(
      isDesignPreviewEnvironment({
        ...safe,
        VERCEL: "1",
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "preview",
        NEXT_PUBLIC_SITE_URL: "https://preview.example.com",
      }),
    ).toBe(false);
    expect(
      isDesignPreviewEnvironment({
        ...safe,
        OUR_DAYS_RESOURCE_MODE: "supabase",
      }),
    ).toBe(false);
    expect(
      isDesignPreviewEnvironment({
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

  it("accepts Preview when it uses the Production Our Days Supabase and a distinct site origin", () => {
    expect(
      validateOurDaysEnvironment({
        ...productionEnvironment,
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "preview",
        NEXT_PUBLIC_SITE_URL: "https://preview.example.com",
      }),
    ).toMatchObject({
      identity: "preview",
      supabaseProjectRef: productionRef,
    });
  });

  it("binds a hosted Vercel Preview to the existing Our Days Supabase even when stale local flags were copied", () => {
    expect(
      validateOurDaysEnvironment(
        environmentForNextConfig({
          VERCEL: "1",
          VERCEL_ENV: "preview",
          VERCEL_URL: "our-days-git-preview.vercel.app",
          OUR_DAYS_ENVIRONMENT: "production",
          OUR_DAYS_RESOURCE_MODE: "detached",
          OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
          OUR_DAYS_LOCAL_JOURNAL_MODE: "enabled",
          NEXT_PUBLIC_SITE_URL: "https://our-days-neon.vercel.app",
          OUR_DAYS_PRODUCTION_SITE_ORIGIN: "https://our-days-neon.vercel.app",
          OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: productionRef,
          OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF: productionRef,
          OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS: proofRef,
          NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co`,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
            "sb_publishable_environment_contract_fixture",
        }),
      ),
    ).toEqual({
      identity: "preview",
      resourceMode: "supabase",
      siteOrigin: "https://our-days-git-preview.vercel.app",
      supabaseProjectRef: productionRef,
    });
  });

  it("binds a hosted Vercel Preview to VERCEL_URL even when a non-production SITE_URL was copied", () => {
    const previewWithCopiedStaging = {
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_URL: "our-days-git-preview.vercel.app",
      OUR_DAYS_ENVIRONMENT: "production",
      OUR_DAYS_RESOURCE_MODE: "detached",
      OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
      OUR_DAYS_LOCAL_JOURNAL_MODE: "enabled",
      NEXT_PUBLIC_SITE_URL: "https://our-days-staging.vercel.app",
      OUR_DAYS_PRODUCTION_SITE_ORIGIN: "https://our-days-neon.vercel.app",
      OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: productionRef,
      OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF: productionRef,
      OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS: proofRef,
      NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        "sb_publishable_environment_contract_fixture",
    } as const;

    expect(environmentForNextConfig(previewWithCopiedStaging)).toMatchObject({
      NEXT_PUBLIC_SITE_URL: "https://our-days-git-preview.vercel.app",
    });
    expect(resolvedSiteOrigin(previewWithCopiedStaging)).toBe(
      "https://our-days-git-preview.vercel.app",
    );
    expect(
      validateOurDaysEnvironment(
        environmentForNextConfig(previewWithCopiedStaging),
      ),
    ).toEqual({
      identity: "preview",
      resourceMode: "supabase",
      siteOrigin: "https://our-days-git-preview.vercel.app",
      supabaseProjectRef: productionRef,
    });
  });

  it("rejects a hosted Vercel Preview that is still missing the Our Days public Supabase values", () => {
    expectUnsafe(
      environmentForNextConfig({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_URL: "our-days-git-preview.vercel.app",
        OUR_DAYS_ENVIRONMENT: "preview",
        OUR_DAYS_RESOURCE_MODE: "detached",
        OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
        NEXT_PUBLIC_SITE_URL: "https://our-days-git-preview.vercel.app",
        OUR_DAYS_PRODUCTION_SITE_ORIGIN: "https://our-days-neon.vercel.app",
      }),
      "NEXT_PUBLIC_SUPABASE_URL is required",
    );
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

  it("rejects project URL mismatch, a second Preview Supabase project, and Proof refs", () => {
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
      "Preview must not use the Production site origin",
    );
    expectUnsafe(
      {
        ...productionEnvironment,
        VERCEL_ENV: "preview",
        OUR_DAYS_ENVIRONMENT: "preview",
        OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: previewRef,
        NEXT_PUBLIC_SITE_URL: "https://preview.example.com",
        NEXT_PUBLIC_SUPABASE_URL: `https://${previewRef}.supabase.co`,
      },
      "Preview must use the existing Our Days Supabase project",
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
      "current publishable key or public anon JWT",
    );
    expect(
      validateOurDaysEnvironment({
        ...productionEnvironment,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `e30.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.fixture`,
      }),
    ).toMatchObject({
      identity: "production",
      supabaseProjectRef: productionRef,
    });
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
