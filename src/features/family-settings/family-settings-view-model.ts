import type { AccentToken } from "@/features/accent-token";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";

export type FamilyAccessMemberViewModel = Readonly<{
  id: string;
  membershipId: string | null;
  profileKind: "account" | "managed";
  role: "member" | "organizer" | null;
  name: string;
  initial: string;
  accent: AccentToken;
  relationshipLabel: string;
  accessLabel: string;
  guardianMembershipIds: readonly string[];
  canManageRole: boolean;
  canManageJournal: boolean;
  canReviewRemoval: boolean;
}>;

export type GuardianOptionViewModel = Readonly<{
  membershipId: string;
  personId: string;
  name: string;
  role: "member" | "organizer";
}>;

export type PendingFamilyInvitationViewModel = Readonly<{
  emailRequestId: string;
  displayName: string;
  state: "queued" | "provisioned" | "delivered";
  statusLabel: string;
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
  guardianOptions: readonly GuardianOptionViewModel[];
  pendingInvitations: readonly PendingFamilyInvitationViewModel[];
  invitationDelivery: "disabled" | "enabled";
}>;

export type FamilySettingsPanelViewModel =
  PreviewFamilySettingsPanelViewModel | ConnectedFamilySettingsPanelViewModel;

export type FamilySettingsViewModel = Readonly<{
  chrome: JournalChromeViewModel;
  panel: FamilySettingsPanelViewModel;
}>;
