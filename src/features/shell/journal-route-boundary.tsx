"use client";

import { catchError, type ErrorInfo } from "next/error";
import { JournalInterrupted } from "./journal-interrupted";

function JournalRouteFallback(_props: object, { retry, reset }: ErrorInfo) {
  return <JournalInterrupted retry={retry} reset={reset} />;
}

export const JournalRouteBoundary = catchError(JournalRouteFallback);
