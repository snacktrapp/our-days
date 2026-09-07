import { FamilySettingsPanel } from "@/features/family-settings/family-settings-panel";
import { JournalChrome } from "@/features/shell/journal-chrome";
import {
  AccountPanelInterrupted,
  JournalRefreshInterrupted,
} from "@/features/shell/journal-interrupted";
import { getFamilySettingsFixture } from "@/fixtures/design-preview/timelines.server";
import {
  readJournalCircleMemberships,
  requireJournalAccess,
} from "@/lib/auth/journal-access";
import {
  buildConnectedFamilySettingsModel,
  loadConnectedFamilyAccess,
  loadConnectedFamilyDirectory,
} from "@/data/family-settings.server";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import {
  requestFamilyInvitationAction,
  revokeFamilyMembershipAction,
  setFamilyMembershipRoleAction,
  setManagedProfileGuardianAction,
  withdrawFamilyInvitationEmailRequestAction,
} from "@/features/family-settings/family-settings-actions";
import { invitationDeliveryIsEnabled } from "../../../../../config/our-days-environment";
import { AccountTools } from "@/features/family-settings/account-tools";
import { createFamilyMomentAction } from "@/features/moments/moment-actions";
import { createGroupAction } from "@/features/groups/create-group-action";
import { previewGroupOptions } from "@/data/preview-groups.server";

export default async function FamilySettingsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ inviteCircle?: string }>;
}>) {
  const { inviteCircle } = await searchParams;
  const access = await requireJournalAccess();
  if (access.mode === "preview") {
    const model = getFamilySettingsFixture(await previewGroupOptions());
    const inviteGroup = model.panel.groups.find(
      (group) => group.id === inviteCircle,
    );
    return (
      <JournalChrome model={model.chrome} section="settings">
        <FamilySettingsPanel
          model={model.panel}
          createGroupAction={createGroupAction}
          inviteCircleId={inviteGroup?.id}
          inviteCircleName={inviteGroup?.name}
        >
          <AccountTools />
        </FamilySettingsPanel>
      </JournalChrome>
    );
  }

  let context;
  try {
    context = await loadConnectedJournalContext(access);
  } catch {
    return <JournalRefreshInterrupted />;
  }

  const groupIds = (context.groups ?? [{ id: access.circleId }]).map(
    (group) => group.id,
  );

  let familyAccess;
  let directory;
  let viewerMemberships;
  try {
    [directory, viewerMemberships] = await Promise.all([
      loadConnectedFamilyDirectory(access, groupIds),
      readJournalCircleMemberships(),
    ]);
    familyAccess =
      directory.get(access.circleId) ??
      (await loadConnectedFamilyAccess(access));
  } catch {
    return (
      <JournalChrome
        model={{
          ...context.chrome,
          title: "Account",
          settingsHref: "/settings/family",
        }}
        section="settings"
        createMomentAction={createFamilyMomentAction}
      >
        <AccountPanelInterrupted>
          <AccountTools />
        </AccountPanelInterrupted>
      </JournalChrome>
    );
  }

  const model = buildConnectedFamilySettingsModel(
    access,
    context,
    familyAccess,
    invitationDeliveryIsEnabled(),
    new Map(
      [...directory.entries()].map(([id, data]) => [id, data.people.length]),
    ),
    directory,
    viewerMemberships,
  );
  const inviteGroup = model.panel.groups.find(
    (group) => group.id === inviteCircle,
  );

  return (
    <JournalChrome
      model={model.chrome}
      section="settings"
      createMomentAction={createFamilyMomentAction}
    >
      <FamilySettingsPanel
        model={model.panel}
        createGroupAction={createGroupAction}
        inviteCircleId={inviteGroup?.id}
        inviteCircleName={inviteGroup?.name}
        actions={{
          requestInvitation: requestFamilyInvitationAction,
          revokeMembership: revokeFamilyMembershipAction,
          setMembershipRole: setFamilyMembershipRoleAction,
          setGuardian: setManagedProfileGuardianAction,
          withdrawInvitation: withdrawFamilyInvitationEmailRequestAction,
        }}
      >
        <AccountTools />
      </FamilySettingsPanel>
    </JournalChrome>
  );
}
