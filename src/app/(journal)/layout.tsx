import { requireJournalAccess } from "@/lib/auth/journal-access";
import { JournalRouteBoundary } from "@/features/shell/journal-route-boundary";

export const dynamic = "force-dynamic";

export default async function JournalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireJournalAccess();

  return <JournalRouteBoundary>{children}</JournalRouteBoundary>;
}
