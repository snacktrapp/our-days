import { RoutePendingSkeleton } from "./journal-pending-route";

export function OpeningJournalShell() {
  // The persistent layout owns navigation, including during loading.
  return <RoutePendingSkeleton kind="timeline" />;
}
