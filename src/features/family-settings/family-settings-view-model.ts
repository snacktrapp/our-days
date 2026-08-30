import type { AccentToken } from "@/features/accent-token";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";

export type FamilyAccessMemberViewModel = Readonly<{
  id: string;
  name: string;
  initial: string;
  accent: AccentToken;
  relationshipLabel: string;
  accessLabel: string;
  canPreviewRemoval: boolean;
}>;

export type FamilySettingsPanelViewModel = Readonly<{
  intro: string;
  currentMemberId: string;
  members: readonly FamilyAccessMemberViewModel[];
}>;

export type FamilySettingsViewModel = Readonly<{
  chrome: JournalChromeViewModel;
  panel: FamilySettingsPanelViewModel;
}>;
