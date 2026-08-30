import type { MomentComposerViewModel } from "@/features/composer/composer-view-model";
import type { AccentToken } from "@/features/accent-token";

export type JournalSection = "timeline" | "people" | "memories";

export type JournalChromeViewModel = Readonly<{
  accent: AccentToken;
  title: string;
  eyebrow: string;
  composer: MomentComposerViewModel;
  familyMark: readonly Readonly<{
    id: string;
    initial: string;
    accent: AccentToken;
  }>[];
}>;
