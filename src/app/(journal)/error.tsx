"use client";

import { JournalSegmentError } from "@/features/shell/journal-route-boundary";

export default function JournalError({
  error,
  retry,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}>) {
  return <JournalSegmentError error={error} retry={retry} reset={reset} />;
}
