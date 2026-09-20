"use client";

import { createContext, useContext } from "react";
import type { JournalChromeProps } from "./journal-chrome";

export type JournalShellRegistration = Omit<JournalChromeProps, "children">;
export const JournalShellContext = createContext<
  ((page: JournalShellRegistration) => void) | null
>(null);

export function useJournalShell() {
  return useContext(JournalShellContext);
}
