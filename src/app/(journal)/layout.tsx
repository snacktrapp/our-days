import { JournalRouteBoundary } from "@/features/shell/journal-route-boundary";
import { PersistentJournalShell } from "@/features/shell/journal-chrome";

export const dynamic = "force-dynamic";

export default function JournalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <PersistentJournalShell>
      <JournalRouteBoundary>{children}</JournalRouteBoundary>
    </PersistentJournalShell>
  );
}
