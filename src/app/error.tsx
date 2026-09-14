"use client";

import { OpeningJournalShell } from "@/features/shell/opening-journal-shell";
import { JournalInterrupted } from "@/features/shell/journal-interrupted";
import {
  isFatalJournalHomeError,
  isNextControlFlowError,
} from "@/lib/auth/family-session-error";

export default function RootError({
  error,
  retry,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}>) {
  if (isNextControlFlowError(error)) throw error;
  if (!isFatalJournalHomeError(error)) return <OpeningJournalShell />;
  return <JournalInterrupted retry={retry} reset={reset} />;
}
