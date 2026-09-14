import { JournalRouteBoundary } from "@/features/shell/journal-route-boundary";

export const dynamic = "force-dynamic";

export default function JournalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <JournalRouteBoundary>{children}</JournalRouteBoundary>;
}
