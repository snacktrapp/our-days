import { PrivateEntry } from "@/features/auth/private-entry";

type SignInPageProps = Readonly<{
  searchParams: Promise<{ cleanup?: string }>;
}>;

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { cleanup } = await searchParams;
  return (
    <PrivateEntry
      connected={process.env.OUR_DAYS_RESOURCE_MODE === "supabase"}
      cleanupIncomplete={cleanup === "incomplete"}
    />
  );
}
