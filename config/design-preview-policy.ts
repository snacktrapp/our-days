type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

export function isDesignPreviewEnvironment(environment: ProcessEnvironment) {
  if (
    environment.VERCEL === "1" ||
    environment.OUR_DAYS_ENABLE_DESIGN_PREVIEW !== "true" ||
    environment.OUR_DAYS_RESOURCE_MODE !== "detached"
  ) {
    return false;
  }

  try {
    const site = new URL(environment.NEXT_PUBLIC_SITE_URL ?? "");
    const loopback =
      site.hostname === "localhost" ||
      site.hostname.endsWith(".localhost") ||
      site.hostname === "127.0.0.1" ||
      site.hostname === "[::1]";
    const isBareOrigin =
      !site.username &&
      !site.password &&
      site.pathname === "/" &&
      !site.search &&
      !site.hash;
    if (!isBareOrigin) return false;

    if (environment.OUR_DAYS_ENVIRONMENT === "local") {
      return loopback && ["http:", "https:"].includes(site.protocol);
    }

    return (
      environment.OUR_DAYS_ENVIRONMENT === "preview" &&
      environment.VERCEL_ENV === "preview" &&
      !loopback &&
      site.protocol === "https:"
    );
  } catch {
    return false;
  }
}
