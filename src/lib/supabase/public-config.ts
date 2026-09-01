export type SupabasePublicConfig = Readonly<{
  url: string;
  publishableKey: string;
}>;

type PublicEnvironment = Readonly<Record<string, string | undefined>>;

function browserVisibleEnvironment(): PublicEnvironment {
  // Keep these as direct property reads so Next.js can inline the two
  // explicitly public values into client bundles.
  return {
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
}

export function readSupabasePublicConfig(
  environment: PublicEnvironment = browserVisibleEnvironment(),
): SupabasePublicConfig {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase public configuration is unavailable");
  }

  return Object.freeze({ url, publishableKey });
}

export function readOptionalSupabasePublicConfig(
  environment: PublicEnvironment = browserVisibleEnvironment(),
) {
  const hasUrl = Boolean(environment.NEXT_PUBLIC_SUPABASE_URL);
  const hasKey = Boolean(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (!hasUrl && !hasKey) return null;
  return readSupabasePublicConfig(environment);
}
