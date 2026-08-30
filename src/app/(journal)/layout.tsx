import { requirePreviewFixtureAccess } from "@/lib/auth/journal-access";

export const dynamic = "force-dynamic";

export default async function JournalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePreviewFixtureAccess();

  return children;
}
