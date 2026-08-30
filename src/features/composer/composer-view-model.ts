import type { AccentToken } from "@/features/accent-token";

export type ComposerPersonOption = Readonly<{
  id: string;
  name: string;
  initial: string;
  accent: AccentToken;
  contextLabel: string;
}>;

export type MomentComposerViewModel = Readonly<{
  experience?: "preview" | "connected-written";
  previewToday: string;
  defaultJournalPersonId: string;
  recorderPersonId: string;
  recordedByName: string;
  journalPeople: readonly ComposerPersonOption[];
  taggablePeople: readonly ComposerPersonOption[];
}>;
