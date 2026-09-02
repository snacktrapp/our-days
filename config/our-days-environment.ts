import { isIP } from "node:net";
import { isDesignPreviewEnvironment } from "./design-preview-policy";
import { resolveSupabaseOrigin, SupabaseOriginError } from "./supabase-origin";

type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

export type OurDaysEnvironmentIdentity = "local" | "preview" | "production";
export type OurDaysResourceMode = "detached" | "supabase";
export type OurDaysInvitationDeliveryMode = "disabled" | "enabled";
export type OurDaysMediaDeliveryMode = "disabled" | "enabled";
export type OurDaysPhotoPostingMode = "disabled" | "enabled";

export type OurDaysEnvironment = Readonly<{
  identity: OurDaysEnvironmentIdentity;
  resourceMode: OurDaysResourceMode;
  siteOrigin?: string;
  supabaseProjectRef?: string;
}>;

const environmentIdentities = new Set<OurDaysEnvironmentIdentity>([
  "local",
  "preview",
  "production",
]);
const resourceModes = new Set<OurDaysResourceMode>(["detached", "supabase"]);
const invitationDeliveryModes = new Set<OurDaysInvitationDeliveryMode>([
  "disabled",
  "enabled",
]);
const mediaDeliveryModes = new Set<OurDaysMediaDeliveryMode>([
  "disabled",
  "enabled",
]);
const photoPostingModes = new Set<OurDaysPhotoPostingMode>([
  "disabled",
  "enabled",
]);
const projectRefPattern = /^[a-z0-9]{20}$/;
const allowedPublicSupabaseEnvironmentNames = new Set([
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
]);
const alternateSupabaseEnvironmentNamePattern =
  /(?:^|_)SUPABASE_(?:ACCESS_TOKEN|ANON_KEY|KEY|PUBLISHABLE_KEY|URL)$/;
const privilegedSupabaseEnvironmentNamePattern =
  /SUPABASE.*(?:ACCESS|ANON|DB|JWT|KEY|PASSWORD|PRIVATE|PUBLISHABLE|SECRET|SERVICE|SIGNING|TOKEN|URL)/;
const privilegedWebEnvironmentNames = [
  "DB_PASSWORD",
  "DATABASE_URL",
  "DATABASE_PASSWORD",
  "DIRECT_URL",
  "JWT_PRIVATE_KEY",
  "JWT_SIGNING_KEY",
  "PGDATABASE",
  "PGHOST",
  "PGHOSTADDR",
  "PGPASSWORD",
  "PGPASSFILE",
  "PGPORT",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSSLCERT",
  "PGSSLCRL",
  "PGSSLKEY",
  "PGSSLROOTCERT",
  "PGUSER",
  "POSTGRES_DATABASE",
  "POSTGRES_HOST",
  "POSTGRES_PASSWORD",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_USER",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_ANON_KEY",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_DB_URL",
  "SUPABASE_JWT_SECRET",
  "SUPABASE_URL",
  "SB_SECRET_KEY",
] as const;

export class OurDaysEnvironmentError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Our Days environment is unsafe:\n- ${issues.join("\n- ")}`);
    this.name = "OurDaysEnvironmentError";
    this.issues = issues;
  }
}

function configuredValue(
  environment: ProcessEnvironment,
  name: string,
  issues: string[],
) {
  const value = environment[name];
  if (value === undefined || value === "") return undefined;
  if (value !== value.trim()) {
    issues.push(`${name} must not contain surrounding whitespace`);
    return undefined;
  }
  return value;
}

function parseIdentity(value: string | undefined, issues: string[]) {
  if (!value) {
    issues.push("OUR_DAYS_ENVIRONMENT is required");
    return undefined;
  }
  if (!environmentIdentities.has(value as OurDaysEnvironmentIdentity)) {
    issues.push("OUR_DAYS_ENVIRONMENT must be local, preview, or production");
    return undefined;
  }
  return value as OurDaysEnvironmentIdentity;
}

function parseResourceMode(value: string | undefined, issues: string[]) {
  if (!value) {
    issues.push("OUR_DAYS_RESOURCE_MODE is required");
    return undefined;
  }
  if (!resourceModes.has(value as OurDaysResourceMode)) {
    issues.push("OUR_DAYS_RESOURCE_MODE must be detached or supabase");
    return undefined;
  }
  return value as OurDaysResourceMode;
}

function parseOrigin(
  value: string | undefined,
  options: Readonly<{
    fieldName: string;
    required: boolean;
    allowLoopback: boolean;
  }>,
  issues: string[],
) {
  if (!value) {
    if (options.required) issues.push(`${options.fieldName} is required`);
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push(`${options.fieldName} must be a valid absolute URL`);
    return undefined;
  }

  if (
    url.username ||
    url.password ||
    url.hostname.includes("*") ||
    url.hostname.endsWith(".") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    issues.push(
      `${options.fieldName} must be an origin without credentials, path, query, or fragment`,
    );
  }

  const loopback =
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  const ipHostname = url.hostname.replace(/^\[|\]$/g, "");
  if (options.allowLoopback) {
    if (!loopback || !["http:", "https:"].includes(url.protocol)) {
      issues.push(`${options.fieldName} must use a loopback host`);
    }
  } else {
    if (url.protocol !== "https:") {
      issues.push(`${options.fieldName} must use HTTPS`);
    }
    if (loopback) {
      issues.push(`${options.fieldName} must not use a loopback host`);
    }
    if (isIP(ipHostname) !== 0) {
      issues.push(`${options.fieldName} must use a DNS hostname`);
    }
  }

  return url.origin;
}

function parseProjectRef(
  value: string | undefined,
  fieldName: string,
  identity: OurDaysEnvironmentIdentity | undefined,
  issues: string[],
) {
  if (!value) return undefined;
  if (identity === "local" && value === "local") return value;
  if (!projectRefPattern.test(value)) {
    issues.push(
      `${fieldName} must be a 20-character lowercase project reference`,
    );
    return undefined;
  }
  return value;
}

function projectRefFromSupabaseUrl(
  value: string | undefined,
  identity: OurDaysEnvironmentIdentity | undefined,
  issues: string[],
) {
  if (!value) return undefined;

  let resolved;
  try {
    resolved = resolveSupabaseOrigin(value);
  } catch (error) {
    if (
      error instanceof SupabaseOriginError &&
      error.code === "not-base-origin"
    ) {
      issues.push(
        "NEXT_PUBLIC_SUPABASE_URL must be a base origin without credentials, path, query, or fragment",
      );
    } else if (
      error instanceof SupabaseOriginError &&
      error.code === "invalid-url"
    ) {
      issues.push("NEXT_PUBLIC_SUPABASE_URL must be a valid absolute URL");
    } else {
      issues.push(
        "hosted NEXT_PUBLIC_SUPABASE_URL must be the HTTPS base origin for the expected Supabase project",
      );
    }
    return undefined;
  }

  if (identity === "local" && resolved.local) {
    return "local";
  }

  if (resolved.local) {
    issues.push(
      "hosted NEXT_PUBLIC_SUPABASE_URL must be the HTTPS base origin for the expected Supabase project",
    );
    return undefined;
  }
  return resolved.projectRef;
}

function configuredForbiddenRefs(
  value: string | undefined,
  resourceMode: OurDaysResourceMode | undefined,
  issues: string[],
) {
  if (!value) {
    if (resourceMode === "supabase") {
      issues.push(
        "OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS must list every known Proof project reference",
      );
    }
    return new Set<string>();
  }

  const refs = value.split(",").filter(Boolean);
  if (
    refs.length === 0 ||
    refs.some((ref) => !projectRefPattern.test(ref)) ||
    new Set(refs).size !== refs.length
  ) {
    issues.push(
      "OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS must be a unique comma-separated list of project references",
    );
    return new Set<string>();
  }
  return new Set(refs);
}

function rejectPrivilegedWebCredentials(
  environment: ProcessEnvironment,
  issues: string[],
) {
  const configuredNames = Object.entries(environment)
    .filter(([, value]) => Boolean(value))
    .map(([name]) => name)
    .filter((name) => {
      const normalizedName = name.toUpperCase();
      if (allowedPublicSupabaseEnvironmentNames.has(normalizedName))
        return false;
      return (
        privilegedWebEnvironmentNames.some(
          (forbiddenName) =>
            normalizedName === forbiddenName ||
            normalizedName.endsWith(`_${forbiddenName}`),
        ) ||
        privilegedSupabaseEnvironmentNamePattern.test(normalizedName) ||
        alternateSupabaseEnvironmentNamePattern.test(normalizedName)
      );
    })
    .sort();

  const dangerousValueNames = Object.entries(environment)
    .filter(([, value]) => {
      if (!value) return false;
      const normalizedValue = value.trim();
      if (
        normalizedValue.startsWith("sb_secret_") ||
        normalizedValue.startsWith("sbp_") ||
        /^postgres(?:ql)?:\/\//i.test(normalizedValue) ||
        /^-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(normalizedValue)
      ) {
        return true;
      }

      const segments = normalizedValue.split(".");
      if (segments.length !== 3) return false;
      try {
        const payload = JSON.parse(
          Buffer.from(segments[1], "base64url").toString("utf8"),
        ) as { role?: unknown };
        return payload.role === "service_role";
      } catch {
        return false;
      }
    })
    .map(([name]) => name)
    .sort();

  const rejectedNames = [
    ...new Set([...configuredNames, ...dangerousValueNames]),
  ].sort();
  if (rejectedNames.length > 0) {
    issues.push(
      `the web process must not contain privileged database or Supabase credentials (${rejectedNames.join(", ")})`,
    );
  }
}

export function validateOurDaysEnvironment(
  environment: ProcessEnvironment,
): OurDaysEnvironment {
  const issues: string[] = [];
  rejectPrivilegedWebCredentials(environment, issues);

  const identity = parseIdentity(
    configuredValue(environment, "OUR_DAYS_ENVIRONMENT", issues),
    issues,
  );
  const resourceMode = parseResourceMode(
    configuredValue(environment, "OUR_DAYS_RESOURCE_MODE", issues),
    issues,
  );
  const invitationDeliveryMode = configuredValue(
    environment,
    "OUR_DAYS_INVITATION_DELIVERY_MODE",
    issues,
  );
  if (
    invitationDeliveryMode &&
    !invitationDeliveryModes.has(
      invitationDeliveryMode as OurDaysInvitationDeliveryMode,
    )
  ) {
    issues.push(
      "OUR_DAYS_INVITATION_DELIVERY_MODE must be disabled or enabled",
    );
  }
  if (invitationDeliveryMode === "enabled" && resourceMode !== "supabase") {
    issues.push(
      "OUR_DAYS_INVITATION_DELIVERY_MODE=enabled requires supabase resource mode",
    );
  }
  const mediaDeliveryMode = configuredValue(
    environment,
    "OUR_DAYS_MEDIA_DELIVERY_MODE",
    issues,
  );
  if (
    mediaDeliveryMode &&
    !mediaDeliveryModes.has(mediaDeliveryMode as OurDaysMediaDeliveryMode)
  ) {
    issues.push("OUR_DAYS_MEDIA_DELIVERY_MODE must be disabled or enabled");
  }
  if (mediaDeliveryMode === "enabled" && resourceMode !== "supabase") {
    issues.push(
      "OUR_DAYS_MEDIA_DELIVERY_MODE=enabled requires supabase resource mode",
    );
  }
  const photoPostingMode = configuredValue(
    environment,
    "OUR_DAYS_PHOTO_POSTING_MODE",
    issues,
  );
  if (
    photoPostingMode &&
    !photoPostingModes.has(photoPostingMode as OurDaysPhotoPostingMode)
  ) {
    issues.push("OUR_DAYS_PHOTO_POSTING_MODE must be disabled or enabled");
  }
  if (photoPostingMode === "enabled" && resourceMode !== "supabase") {
    issues.push(
      "OUR_DAYS_PHOTO_POSTING_MODE=enabled requires supabase resource mode",
    );
  }
  const designPreview = configuredValue(
    environment,
    "OUR_DAYS_ENABLE_DESIGN_PREVIEW",
    issues,
  );
  if (designPreview && designPreview !== "true" && designPreview !== "false") {
    issues.push("OUR_DAYS_ENABLE_DESIGN_PREVIEW must be true or false");
  }
  const siteOrigin = parseOrigin(
    configuredValue(environment, "NEXT_PUBLIC_SITE_URL", issues),
    {
      fieldName: "NEXT_PUBLIC_SITE_URL",
      required: identity !== "local",
      allowLoopback: identity === "local",
    },
    issues,
  );
  const productionSiteOrigin = parseOrigin(
    configuredValue(environment, "OUR_DAYS_PRODUCTION_SITE_ORIGIN", issues),
    {
      fieldName: "OUR_DAYS_PRODUCTION_SITE_ORIGIN",
      required: identity === "preview" || identity === "production",
      allowLoopback: false,
    },
    issues,
  );
  if (designPreview === "true" && !isDesignPreviewEnvironment(environment)) {
    issues.push(
      "OUR_DAYS_ENABLE_DESIGN_PREVIEW=true requires an explicit local loopback or Vercel Preview identity with detached resources",
    );
  }

  const vercelEnvironment = configuredValue(environment, "VERCEL_ENV", issues);
  const expectedVercelIdentity =
    vercelEnvironment === "development" ? "local" : vercelEnvironment;
  if (
    expectedVercelIdentity &&
    expectedVercelIdentity !== "preview" &&
    expectedVercelIdentity !== "production" &&
    expectedVercelIdentity !== "local"
  ) {
    issues.push(
      "VERCEL_ENV must be development, preview, or production when configured",
    );
  } else if (
    identity &&
    expectedVercelIdentity &&
    identity !== expectedVercelIdentity
  ) {
    issues.push("OUR_DAYS_ENVIRONMENT must match VERCEL_ENV");
  }

  const expectedRef = parseProjectRef(
    configuredValue(
      environment,
      "OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF",
      issues,
    ),
    "OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF",
    identity,
    issues,
  );
  const productionRef = parseProjectRef(
    configuredValue(
      environment,
      "OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF",
      issues,
    ),
    "OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF",
    identity,
    issues,
  );
  const supabaseUrl = configuredValue(
    environment,
    "NEXT_PUBLIC_SUPABASE_URL",
    issues,
  );
  const urlRef = projectRefFromSupabaseUrl(supabaseUrl, identity, issues);
  const publishableKey = configuredValue(
    environment,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    issues,
  );
  const forbiddenRefs = configuredForbiddenRefs(
    configuredValue(
      environment,
      "OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS",
      issues,
    ),
    resourceMode,
    issues,
  );

  if (resourceMode === "detached") {
    if (
      identity &&
      identity !== "local" &&
      !isDesignPreviewEnvironment(environment)
    ) {
      issues.push(
        "detached resource mode is allowed only for local, synthetic CI, or explicit Vercel design previews",
      );
    }
    if (expectedRef || productionRef || supabaseUrl || publishableKey) {
      issues.push(
        "detached resource mode must not include Supabase connection values",
      );
    }
  }

  if (
    identity === "preview" &&
    siteOrigin &&
    productionSiteOrigin &&
    siteOrigin === productionSiteOrigin
  ) {
    issues.push("Preview must not use the Production site origin");
  }

  if (resourceMode === "supabase") {
    if (!expectedRef)
      issues.push(
        "OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF is required in supabase mode",
      );
    if (!supabaseUrl)
      issues.push("NEXT_PUBLIC_SUPABASE_URL is required in supabase mode");
    if (!publishableKey) {
      issues.push(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required in supabase mode",
      );
    } else if (
      !publishableKey.startsWith("sb_publishable_") ||
      publishableKey.length < 24
    ) {
      issues.push(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must use a current publishable key",
      );
    }
    if (expectedRef && urlRef && expectedRef !== urlRef) {
      issues.push(
        "NEXT_PUBLIC_SUPABASE_URL does not match OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF",
      );
    }
    if (expectedRef && forbiddenRefs.has(expectedRef)) {
      issues.push(
        "OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF is a forbidden Proof resource",
      );
    }

    if (identity === "preview") {
      if (!productionRef) {
        issues.push(
          "OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF is required in Preview",
        );
      } else if (expectedRef === productionRef) {
        issues.push("Preview must not use the Production Supabase project");
      }
      if (
        siteOrigin &&
        productionSiteOrigin &&
        siteOrigin === productionSiteOrigin
      ) {
        issues.push("Preview must not use the Production site origin");
      }
    } else if (identity === "production") {
      if (!productionRef) {
        issues.push(
          "OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF is required in Production",
        );
      } else if (expectedRef !== productionRef) {
        issues.push(
          "Production must use its declared Production Supabase project",
        );
      }
      if (
        siteOrigin &&
        productionSiteOrigin &&
        siteOrigin !== productionSiteOrigin
      ) {
        issues.push("Production must use its declared Production site origin");
      }
    } else if (identity === "local" && expectedRef && expectedRef !== "local") {
      if (!productionRef) {
        issues.push(
          "OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF is required when local uses a hosted project",
        );
      } else if (expectedRef === productionRef) {
        issues.push(
          "local development must not use the Production Supabase project",
        );
      }
    }
  }

  if (productionRef && forbiddenRefs.has(productionRef)) {
    issues.push(
      "OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF is a forbidden Proof resource",
    );
  }

  if (issues.length > 0 || !identity || !resourceMode) {
    throw new OurDaysEnvironmentError(issues);
  }

  return Object.freeze({
    identity,
    resourceMode,
    ...(siteOrigin ? { siteOrigin } : {}),
    ...(expectedRef ? { supabaseProjectRef: expectedRef } : {}),
  });
}

export function invitationDeliveryIsEnabled(
  environment: ProcessEnvironment = process.env,
) {
  return (
    environment.OUR_DAYS_INVITATION_DELIVERY_MODE === "enabled" &&
    environment.OUR_DAYS_RESOURCE_MODE === "supabase"
  );
}

export function mediaDeliveryIsEnabled(
  environment: ProcessEnvironment = process.env,
) {
  return (
    environment.OUR_DAYS_MEDIA_DELIVERY_MODE === "enabled" &&
    environment.OUR_DAYS_RESOURCE_MODE === "supabase"
  );
}

export function photoPostingIsEnabled(
  environment: ProcessEnvironment = process.env,
) {
  return (
    environment.OUR_DAYS_PHOTO_POSTING_MODE === "enabled" &&
    environment.OUR_DAYS_RESOURCE_MODE === "supabase"
  );
}

export function environmentForNextConfig(
  environment: ProcessEnvironment,
): ProcessEnvironment {
  const managedExecution =
    environment.CI === "true" || Boolean(environment.VERCEL_ENV);
  if (managedExecution) return environment;

  return {
    ...environment,
    OUR_DAYS_ENVIRONMENT: environment.OUR_DAYS_ENVIRONMENT ?? "local",
    OUR_DAYS_RESOURCE_MODE: environment.OUR_DAYS_RESOURCE_MODE ?? "detached",
  };
}
