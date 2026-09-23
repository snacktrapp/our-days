import { FamilySettingsPanel } from "@/features/family-settings/family-settings-panel";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { AccountPanelInterrupted } from "@/features/shell/journal-interrupted";
import {
  readJournalCircleMemberships,
  requireJournalAccessUnlessRecoverable,
} from "@/lib/auth/journal-access";
import { isFatalJournalHomeError } from "@/lib/auth/family-session-error";
import {
  anonymousJournalAccess,
  fallbackJournalChrome,
} from "@/data/journal-chrome-fallback";
import {
  buildConnectedFamilySettingsModel,
  loadConnectedFamilyAccess,
  loadConnectedFamilyDirectory,
} from "@/data/family-settings.server";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import {
  addExistingCircleMemberAction,
  listExistingCircleMembersAction,
  requestFamilyInvitationAction,
  revokeFamilyMembershipAction,
  setFamilyMembershipRoleAction,
  setManagedProfileGuardianAction,
  withdrawFamilyInvitationEmailRequestAction,
} from "@/features/family-settings/family-settings-actions";
import { invitationDeliveryIsEnabled } from "../../../config/our-days-environment";
import { AccountTools } from "@/features/family-settings/account-tools";
import { createFamilyMomentAction } from "@/features/moments/moment-actions";
import { createGroupAction } from "@/features/groups/create-group-action";
import { renameCircleAction } from "@/features/groups/rename-circle-action";
import { previewGroupOptions } from "@/data/preview-groups.server";
import { countFamilyFacingPeople } from "@/lib/circle-roles";
import { ProfileColorSelector } from "@/features/family-settings/profile-color-selector";
import { SettingsPage } from "@/features/family-settings/settings-directory";
import { saveProfileColorAction } from "@/features/family-settings/profile-color-action";
import type {
  FamilySettingsPanelViewModel,
  FamilySettingsViewModel,
} from "@/features/family-settings/family-settings-view-model";

function ProfileColorSettings({
  model,
}: {
  model: FamilySettingsPanelViewModel;
}) {
  const person = model.groups
    .flatMap((group) => group.members)
    .find((member) => member.id === model.currentMemberId);
  if (!person) return null;
  return (
    <ProfileColorSelector
      key={`${person.id}-${person.accent}`}
      name={person.name}
      initial={person.initial}
      accent={person.accent}
      preview={model.mode === "preview"}
      saveColor={saveProfileColorAction}
    />
  );
}

export default async function AccountScreen({
  searchParams,
  manageCircles = false,
  loadPreview,
}: Readonly<{
  loadPreview: (
    options: Awaited<ReturnType<typeof previewGroupOptions>>,
  ) => FamilySettingsViewModel;
  manageCircles?: boolean;
  searchParams: Promise<{
    inviteCircle?: string;
    previewLoading?: string;
    name?: string;
  }>;
}>) {
  const { inviteCircle, previewLoading, name } = await searchParams;
  const access = await requireJournalAccessUnlessRecoverable();
  if (!access) {
    return (
      <JournalChrome
        model={fallbackJournalChrome(anonymousJournalAccess(), {
          title: manageCircles ? "Circles" : "Settings",
          eyebrow: "Account",
        })}
        section={manageCircles ? "circles" : "settings"}
        preserveChrome
      >
        <AccountPanelInterrupted>
          <AccountTools />
        </AccountPanelInterrupted>
      </JournalChrome>
    );
  }
  if (access.mode === "preview") {
    if (previewLoading === "navigation") {
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    const model = loadPreview(
      await previewGroupOptions({
        circle: inviteCircle,
        name,
      }),
    );
    const inviteGroup = model.panel.groups.find(
      (group) => group.id === inviteCircle,
    );
    return (
      <JournalChrome
        model={{
          ...model.chrome,
          title: manageCircles ? "Circles" : "Settings",
        }}
        section={manageCircles ? "circles" : "settings"}
      >
        {manageCircles ? (
          <FamilySettingsPanel
            model={model.panel}
            createGroupAction={createGroupAction}
            renameCircleAction={renameCircleAction}
            inviteCircleId={inviteGroup?.id}
            inviteCircleName={inviteGroup?.name}
            defaultCircleId={model.panel.groups[0]?.id}
          />
        ) : (
          <SettingsPage>
            <ProfileColorSettings model={model.panel} />
            <AccountContents />
          </SettingsPage>
        )}
      </JournalChrome>
    );
  }

  let context;
  try {
    context = await loadConnectedJournalContext(access);
  } catch (error) {
    if (isFatalJournalHomeError(error)) throw error;
    return (
      <JournalChrome
        model={fallbackJournalChrome(access, {
          title: manageCircles ? "Circles" : "Settings",
          eyebrow: "Account",
        })}
        section={manageCircles ? "circles" : "settings"}
        createMomentAction={createFamilyMomentAction}
        preserveChrome
      >
        <AccountPanelInterrupted>
          <AccountTools />
        </AccountPanelInterrupted>
      </JournalChrome>
    );
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
          title: manageCircles ? "Circles" : "Settings",
          settingsHref: "/settings/family",
        }}
        section={manageCircles ? "circles" : "settings"}
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
      [...directory.entries()].map(([id, data]) => [
        id,
        countFamilyFacingPeople(data.people, data.memberships),
      ]),
    ),
    directory,
    viewerMemberships,
  );
  const inviteGroup = model.panel.groups.find(
    (group) => group.id === inviteCircle,
  );

  return (
    <JournalChrome
      model={{
        ...model.chrome,
        title: manageCircles ? "Circles" : "Settings",
      }}
      section={manageCircles ? "circles" : "settings"}
      createMomentAction={createFamilyMomentAction}
    >
      {manageCircles ? (
        <FamilySettingsPanel
          model={model.panel}
          createGroupAction={createGroupAction}
          renameCircleAction={renameCircleAction}
          inviteCircleId={inviteGroup?.id}
          inviteCircleName={inviteGroup?.name}
          defaultCircleId={access.circleId}
          actions={{
            existingMembers: {
              list: listExistingCircleMembersAction,
              add: addExistingCircleMemberAction,
            },
            requestInvitation: requestFamilyInvitationAction,
            revokeMembership: revokeFamilyMembershipAction,
            setMembershipRole: setFamilyMembershipRoleAction,
            setGuardian: setManagedProfileGuardianAction,
            withdrawInvitation: withdrawFamilyInvitationEmailRequestAction,
          }}
        />
      ) : (
        <SettingsPage>
          <ProfileColorSettings model={model.panel} />
          <AccountContents />
        </SettingsPage>
      )}
    </JournalChrome>
  );
}

function AccountContents() {
  return <AccountTools />;
}
