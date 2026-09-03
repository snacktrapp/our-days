import { FamilySettingsPanel } from "@/features/family-settings/family-settings-panel";
import { JournalChrome } from "@/features/shell/journal-chrome";
import {
  AccountPanelInterrupted,
  JournalRefreshInterrupted,
} from "@/features/shell/journal-interrupted";
import { getFamilySettingsFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import {
  buildConnectedFamilySettingsModel,
  loadConnectedFamilyAccess,
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

export default async function FamilySettingsPage() {
  const access = await requireJournalAccess();
  if (access.mode === "preview") {
    const model = getFamilySettingsFixture();
    return (
      <JournalChrome model={model.chrome} section="settings">
        <FamilySettingsPanel model={model.panel}>
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

  let familyAccess;
  try {
    familyAccess = await loadConnectedFamilyAccess(access);
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
  );

  return (
    <JournalChrome
      model={model.chrome}
      section="settings"
      createMomentAction={createFamilyMomentAction}
    >
      <FamilySettingsPanel
        model={model.panel}
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
