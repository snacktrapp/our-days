export type SupabasePublicConfig = Readonly<{
  url: string;
  publishableKey: string;
}>;

type PublicEnvironment = Readonly<Record<string, string | undefined>>;

export function readSupabasePublicConfig(
  environment: PublicEnvironment = process.env,
): SupabasePublicConfig {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase public configuration is unavailable");
  }

  return Object.freeze({ url, publishableKey });
}

export function readOptionalSupabasePublicConfig(
  environment: PublicEnvironment = process.env,
) {
  const hasUrl = Boolean(environment.NEXT_PUBLIC_SUPABASE_URL);
  const hasKey = Boolean(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (!hasUrl && !hasKey) return null;
  return readSupabasePublicConfig(environment);
}
