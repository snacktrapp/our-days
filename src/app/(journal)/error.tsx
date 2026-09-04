"use client";

import { JournalInterrupted } from "@/features/shell/journal-interrupted";

export default function JournalError({
  retry,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}>) {
  return <JournalInterrupted retry={retry} reset={reset} />;
}
