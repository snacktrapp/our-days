type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

export function isLocalDesignPreviewEnvironment(
  environment: ProcessEnvironment,
) {
  if (
    environment.OUR_DAYS_ENABLE_DESIGN_PREVIEW !== "true" ||
    environment.OUR_DAYS_ENVIRONMENT !== "local" ||
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
    return (
      loopback &&
      !site.username &&
      !site.password &&
      site.pathname === "/" &&
      !site.search &&
      !site.hash &&
      ["http:", "https:"].includes(site.protocol)
    );
  } catch {
    return false;
  }
}
