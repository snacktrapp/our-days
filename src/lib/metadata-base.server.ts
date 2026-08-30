import {
  environmentForNextConfig,
  validateOurDaysEnvironment,
} from "../../config/our-days-environment";

type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveMetadataBase(
  environment: ProcessEnvironment = process.env,
) {
  const configured = validateOurDaysEnvironment(
    environmentForNextConfig(environment),
  );
  return new URL(configured.siteOrigin ?? "http://localhost:3000");
}
