import { PrivateEntry } from "@/features/auth/private-entry";

type SignInPageProps = Readonly<{
  searchParams: Promise<{ cleanup?: string; link?: string }>;
}>;

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { cleanup, link } = await searchParams;
  return (
    <PrivateEntry
      connected={process.env.OUR_DAYS_RESOURCE_MODE === "supabase"}
      cleanupIncomplete={cleanup === "incomplete"}
      linkIssue={
        link === "invalid" || link === "unavailable" ? link : undefined
      }
    />
  );
}
