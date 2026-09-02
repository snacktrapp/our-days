import { PrivateEntry } from "@/features/auth/private-entry";

type SignInPageProps = Readonly<{
  searchParams: Promise<{ cleanup?: string; link?: string; oauth?: string }>;
}>;

const oauthIssues = [
  "unavailable",
  "invalid",
  "no-access",
  "no-email",
] as const;

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { cleanup, link, oauth } = await searchParams;
  return (
    <PrivateEntry
      connected={
        process.env.OUR_DAYS_RESOURCE_MODE === "supabase" ||
        process.env.OUR_DAYS_LOCAL_JOURNAL_MODE === "enabled"
      }
      cleanupIncomplete={cleanup === "incomplete"}
      linkIssue={
        link === "invalid" || link === "unavailable" ? link : undefined
      }
      oauthIssue={
        oauthIssues.includes(oauth as (typeof oauthIssues)[number])
          ? (oauth as (typeof oauthIssues)[number])
          : undefined
      }
    />
  );
}
