"use client";

import { JournalInterrupted } from "@/features/shell/journal-interrupted";

export default function RootError({
  retry,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}>) {
  return <JournalInterrupted retry={retry} reset={reset} />;
}
