import type { AccentToken } from "@/features/accent-token";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";

export type FamilyAccessMemberViewModel = Readonly<{
  id: string;
  membershipId: string | null;
  name: string;
  initial: string;
  accent: AccentToken;
  relationshipLabel: string;
  accessLabel: string;
  canReviewRemoval: boolean;
}>;

export type PendingFamilyInvitationViewModel = Readonly<{
  id: string;
  displayName: string;
  createdLabel: string;
  expiresLabel: string;
}>;

export type PreviewFamilySettingsPanelViewModel = Readonly<{
  mode: "preview";
  intro: string;
  currentMemberId: string;
  members: readonly FamilyAccessMemberViewModel[];
}>;

export type ConnectedFamilySettingsPanelViewModel = Readonly<{
  mode: "connected";
  intro: string;
  currentMemberId: string;
  canManageAccess: boolean;
  members: readonly FamilyAccessMemberViewModel[];
  pendingInvitations: readonly PendingFamilyInvitationViewModel[];
  invitationDelivery: "worker-required";
}>;

export type FamilySettingsPanelViewModel =
  PreviewFamilySettingsPanelViewModel | ConnectedFamilySettingsPanelViewModel;

export type FamilySettingsViewModel = Readonly<{
  chrome: JournalChromeViewModel;
  panel: FamilySettingsPanelViewModel;
}>;
