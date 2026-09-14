import { Suspense } from "react";
import { requireJournalAccessUnlessRecoverable } from "@/lib/auth/journal-access";
import { JournalRouteBoundary } from "@/features/shell/journal-route-boundary";

export const dynamic = "force-dynamic";

async function JournalAccessGate() {
  await requireJournalAccessUnlessRecoverable();
  return null;
}

export default function JournalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <JournalRouteBoundary>
      <Suspense fallback={null}>
        <JournalAccessGate />
      </Suspense>
      {children}
    </JournalRouteBoundary>
  );
}
