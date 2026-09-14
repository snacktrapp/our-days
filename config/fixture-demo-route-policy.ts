import { isDesignPreviewEnvironment } from "./design-preview-policy";

type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

export function isFixtureDemoRouteEnabled(environment: ProcessEnvironment) {
  if (isDesignPreviewEnvironment(environment)) return true;

  return (
    environment.VERCEL === "1" &&
    environment.VERCEL_ENV === "preview" &&
    environment.OUR_DAYS_ENVIRONMENT === "preview"
  );
}
