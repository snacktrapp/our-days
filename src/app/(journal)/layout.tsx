import { requireJournalAccess } from "@/lib/auth/journal-access";
import { PrimaryNavigation } from "@/features/shell/primary-navigation";

export const dynamic = "force-dynamic";

export default async function JournalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireJournalAccess();

  return (
    <>
      {children}
      <PrimaryNavigation section="trash" />
    </>
  );
}
