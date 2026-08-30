import { FamilySettingsPanel } from "@/features/family-settings/family-settings-panel";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { getFamilySettingsFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import {
  buildConnectedFamilySettingsModel,
  loadConnectedFamilyAccess,
} from "@/data/family-settings.server";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import {
  revokeFamilyInvitationAction,
  revokeFamilyMembershipAction,
  setFamilyMembershipRoleAction,
  setManagedProfileGuardianAction,
} from "@/features/family-settings/family-settings-actions";

export default async function FamilySettingsPage() {
  const access = await requireJournalAccess();
  if (access.mode === "preview") {
    const model = getFamilySettingsFixture();
    return (
      <JournalChrome model={model.chrome} section="settings">
        <FamilySettingsPanel model={model.panel} />
      </JournalChrome>
    );
  }

  const [context, familyAccess] = await Promise.all([
    loadConnectedJournalContext(access),
    loadConnectedFamilyAccess(access),
  ]);
  const model = buildConnectedFamilySettingsModel(
    access,
    context,
    familyAccess,
  );

  return (
    <JournalChrome model={model.chrome} section="settings">
      <FamilySettingsPanel
        model={model.panel}
        actions={{
          revokeMembership: revokeFamilyMembershipAction,
          revokeInvitation: revokeFamilyInvitationAction,
          setMembershipRole: setFamilyMembershipRoleAction,
          setGuardian: setManagedProfileGuardianAction,
        }}
      />
    </JournalChrome>
  );
}
