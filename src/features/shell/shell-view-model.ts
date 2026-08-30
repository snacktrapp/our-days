export type AccentToken = "teal" | "clay" | "ochre" | "slate" | "moss";
export type JournalSection = "timeline" | "people" | "memories";

export type JournalChromeViewModel = Readonly<{
  accent: AccentToken;
  title: string;
  eyebrow: string;
  familyMark: readonly Readonly<{
    id: string;
    initial: string;
    accent: AccentToken;
  }>[];
}>;
