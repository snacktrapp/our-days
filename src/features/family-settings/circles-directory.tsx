"use client";

import Link from "next/link";
import { type MutableRefObject, type ReactNode, useState } from "react";
import { groupHomeHref } from "@/features/shell/journal-switcher";
import { withCircleBrowseContext } from "@/features/shell/journal-routes";
import { ArchiveCircleControl } from "@/features/groups/archive-circle-control";
import { countFamilyFacingMembers } from "@/lib/circle-roles";
import {
  addFromCircleLabel,
  AddExistingMemberForm,
  type ExistingMemberActions,
} from "./add-existing-member";
import { CircleManagementSheet } from "./circle-management-sheet";
import {
  SettingsAvatar,
  SettingsChevron,
  SettingsGroup,
  SettingsMoreButton,
  SettingsRow,
  SettingsRowButton,
  SettingsRowCopy,
  SettingsRowLink,
  SettingsRowTrail,
  SettingsSection,
  SettingsSectionLabel,
} from "./settings-directory";
import type {
  FamilyAccessMemberViewModel,
  FamilyCircleViewModel,
  PendingFamilyInvitationViewModel,
} from "./family-settings-view-model";

function peopleCountLabel(count: number) {
  return count === 1 ? "1 person" : `${count} people`;
}

function pendingInitial(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
}

function memberSubtitle(member: FamilyAccessMemberViewModel) {
  if (
    member.role === "organizer" ||
    member.role === "operations" ||
    member.profileKind === "managed"
  ) {
    return member.relationshipLabel;
  }
  return undefined;
}

function memberHasJournal(member: FamilyAccessMemberViewModel) {
  return member.role !== "operations";
}

function memberShowMore(
  member: FamilyAccessMemberViewModel,
  mode: "preview" | "connected",
) {
  return (
    member.canReviewRemoval ||
    (mode === "connected" && (member.canManageRole || member.canManageJournal))
  );
}

export function CircleFeedRow({ circle }: { circle: FamilyCircleViewModel }) {
  const count = countFamilyFacingMembers(circle.members);
  return (
    <SettingsRowLink
      href={groupHomeHref(circle.id)}
      ariaLabel={`Open ${circle.name} circle feed`}
    >
      <SettingsAvatar tile />
      <SettingsRowCopy
        title="Everyone"
        subtitle={`${peopleCountLabel(count)} · the shared journal`}
      />
      <SettingsRowTrail>
        <SettingsChevron />
      </SettingsRowTrail>
    </SettingsRowLink>
  );
}

export function DirectoryMemberRow({
  member,
  circleId,
  currentMemberId,
  mode,
  disabled,
  reviewId,
  onManage,
  triggerRef,
}: {
  member: FamilyAccessMemberViewModel;
  circleId: string;
  currentMemberId: string;
  mode: "preview" | "connected";
  disabled?: boolean;
  reviewId: string | null;
  onManage: (memberId: string, trigger: HTMLButtonElement) => void;
  triggerRef: MutableRefObject<HTMLButtonElement | null>;
}) {
  const hasJournal = memberHasJournal(member);
  const showMore = memberShowMore(member, mode);
  const title = `${member.name}${member.id === currentMemberId ? " · You" : ""}`;
  const subtitle = memberSubtitle(member);
  const journalHref = withCircleBrowseContext(`/people/${member.id}`, circleId);

  if (!hasJournal) {
    return (
      <SettingsRow>
        <SettingsAvatar accent={member.accent} initial={member.initial} />
        <SettingsRowCopy title={title} subtitle={subtitle} />
        <SettingsRowTrail>
          {showMore ? (
            <SettingsMoreButton
              label={
                mode === "connected"
                  ? member.profileKind === "managed"
                    ? `Manage journal for ${member.name}`
                    : `Manage role and access for ${member.name}`
                  : `Review access for ${member.name}`
              }
              expanded={reviewId === member.id}
              controls="access-review"
              disabled={disabled}
              onClick={(event) => {
                triggerRef.current = event.currentTarget;
                onManage(member.id, event.currentTarget);
              }}
            />
          ) : null}
        </SettingsRowTrail>
      </SettingsRow>
    );
  }

  return (
    <SettingsRow className="settings-row-has-link">
      <SettingsAvatar accent={member.accent} initial={member.initial} />
      <SettingsRowCopy title={title} subtitle={subtitle} />
      <SettingsRowTrail>
        {showMore ? (
          <SettingsMoreButton
            label={
              mode === "connected"
                ? member.profileKind === "managed"
                  ? `Manage journal for ${member.name}`
                  : `Manage role and access for ${member.name}`
                : `Review access for ${member.name}`
            }
            expanded={reviewId === member.id}
            controls="access-review"
            disabled={disabled}
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              onManage(member.id, event.currentTarget);
            }}
          />
        ) : null}
        <SettingsChevron />
      </SettingsRowTrail>
      <Link
        className="settings-row-stretched-link"
        href={journalHref}
        prefetch={false}
        aria-label={`${member.name} — open journal`}
      />
    </SettingsRow>
  );
}

export function PendingInviteRow({
  item,
  disabled,
  invitationReviewId,
  onManage,
  triggerRef,
}: {
  item: PendingFamilyInvitationViewModel;
  disabled?: boolean;
  invitationReviewId: string | null;
  onManage: (emailRequestId: string, trigger: HTMLButtonElement) => void;
  triggerRef: MutableRefObject<HTMLButtonElement | null>;
}) {
  const canReview = !item.emailRequestId.startsWith("optimistic:");
  return (
    <SettingsRow>
      <SettingsAvatar initial={pendingInitial(item.displayName)} pending />
      <SettingsRowCopy
        title={item.displayName}
        subtitle="Invitation sent · waiting to accept"
      />
      <SettingsRowTrail>
        {canReview ? (
          <SettingsMoreButton
            label={`Review invitation for ${item.displayName}`}
            expanded={invitationReviewId === item.emailRequestId}
            controls="invitation-review"
            disabled={disabled}
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              onManage(item.emailRequestId, event.currentTarget);
            }}
          />
        ) : null}
      </SettingsRowTrail>
    </SettingsRow>
  );
}

export function CircleDirectory({
  groups,
  mode,
  currentMemberId,
  reviewId,
  invitationReviewId,
  disabled,
  onManageMember,
  onManageInvitation,
  accessTriggerRef,
  invitationTriggerRef,
  inviteCircleId,
  promptFirstMembers,
  onInvite,
  inviteCtaRef,
  onOpenCircleSettings,
  circleSettingsId,
  onOpenAddExisting,
  addExistingCircleId,
  existingMemberActions,
  renderCircleSettings,
  renderAddExisting,
  children,
}: {
  groups: readonly FamilyCircleViewModel[];
  mode: "preview" | "connected";
  currentMemberId?: string;
  reviewId: string | null;
  invitationReviewId: string | null;
  disabled?: boolean;
  onManageMember: (memberId: string) => void;
  onManageInvitation: (emailRequestId: string) => void;
  accessTriggerRef: MutableRefObject<HTMLButtonElement | null>;
  invitationTriggerRef: MutableRefObject<HTMLButtonElement | null>;
  inviteCircleId?: string;
  promptFirstMembers?: boolean;
  onInvite: (circle: FamilyCircleViewModel) => void;
  inviteCtaRef?: MutableRefObject<HTMLButtonElement | null>;
  onOpenCircleSettings: (circleId: string) => void;
  circleSettingsId: string | null;
  onOpenAddExisting: (circleId: string) => void;
  addExistingCircleId: string | null;
  existingMemberActions?: ExistingMemberActions;
  renderCircleSettings: (circle: FamilyCircleViewModel) => ReactNode;
  renderAddExisting: (circle: FamilyCircleViewModel) => ReactNode;
  children?: ReactNode;
}) {
  const activeGroups = groups.filter((group) => !group.archivedAt);
  const archivedGroups = groups.filter((group) => group.archivedAt);

  return (
    <>
      {activeGroups.map((circle) => {
        const sources = groups.filter(
          (group) => group.id !== circle.id && group.canManageAccess,
        );
        const showAddExisting = circle.canManageAccess && sources.length > 0;
        const firstMembers = promptFirstMembers && inviteCircleId === circle.id;
        return (
          <SettingsSection key={circle.id} id={`circle-${circle.id}`}>
            <SettingsSectionLabel
              more={
                circle.canManageAccess ? (
                  <SettingsMoreButton
                    label={`Circle settings for ${circle.name}`}
                    expanded={circleSettingsId === circle.id}
                    controls="circle-settings"
                    disabled={disabled}
                    onClick={() => onOpenCircleSettings(circle.id)}
                  />
                ) : undefined
              }
            >
              {circle.name}
            </SettingsSectionLabel>
            <SettingsGroup>
              <CircleFeedRow circle={circle} />
              {circle.members.map((member) => (
                <DirectoryMemberRow
                  key={member.id}
                  member={member}
                  circleId={circle.id}
                  currentMemberId={circle.currentMemberId}
                  mode={mode}
                  disabled={disabled}
                  reviewId={reviewId}
                  triggerRef={accessTriggerRef}
                  onManage={(memberId, trigger) => {
                    accessTriggerRef.current = trigger;
                    onManageMember(memberId);
                  }}
                />
              ))}
              {(circle.pendingInvitations ?? []).map((item) => (
                <PendingInviteRow
                  key={item.emailRequestId}
                  item={item}
                  disabled={disabled}
                  invitationReviewId={invitationReviewId}
                  triggerRef={invitationTriggerRef}
                  onManage={(emailRequestId, trigger) => {
                    invitationTriggerRef.current = trigger;
                    onManageInvitation(emailRequestId);
                  }}
                />
              ))}
              {circle.canManageAccess ? (
                <SettingsRowButton
                  action
                  buttonRef={firstMembers ? inviteCtaRef : undefined}
                  ariaLabel={
                    firstMembers ? "Add your first members" : "Invite someone"
                  }
                  onClick={() => onInvite(circle)}
                >
                  <SettingsAvatar add />
                  <SettingsRowCopy
                    title={
                      firstMembers ? "Add your first members" : "Invite someone"
                    }
                    subtitle={
                      firstMembers
                        ? `It’s just you in ${circle.name} so far.`
                        : undefined
                    }
                  />
                </SettingsRowButton>
              ) : null}
              {showAddExisting ? (
                <SettingsRowButton
                  action
                  ariaLabel={addFromCircleLabel(sources)}
                  onClick={() => onOpenAddExisting(circle.id)}
                >
                  <SettingsAvatar add />
                  <SettingsRowCopy title={addFromCircleLabel(sources)} />
                </SettingsRowButton>
              ) : null}
            </SettingsGroup>
            {circleSettingsId === circle.id
              ? renderCircleSettings(circle)
              : null}
            {addExistingCircleId === circle.id
              ? renderAddExisting(circle)
              : null}
          </SettingsSection>
        );
      })}
      <PageLevelActions archivedGroups={archivedGroups}>
        {children}
      </PageLevelActions>
    </>
  );
}

function PageLevelActions({
  archivedGroups,
  children,
}: {
  archivedGroups: readonly FamilyCircleViewModel[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const count = archivedGroups.length;
  return (
    <SettingsSection>
      <SettingsGroup>
        {children}
        {count > 0 ? (
          <details
            className="archived-circles-details"
            open={open}
            onToggle={(event) =>
              setOpen((event.currentTarget as HTMLDetailsElement).open)
            }
          >
            <summary className="settings-row settings-row-link archived-circles-summary">
              <SettingsAvatar tile />
              <SettingsRowCopy
                title="Archived circles"
                subtitle={`${count} ${count === 1 ? "circle" : "circles"}`}
              />
              <SettingsRowTrail>
                <SettingsChevron />
              </SettingsRowTrail>
            </summary>
            {archivedGroups.map((group) => (
              <div key={group.id} className="archived-circle-row">
                <strong>{group.name}</strong>
                {group.canManageAccess ? (
                  <ArchiveCircleControl
                    circleId={group.id}
                    name={group.name}
                    archived
                  />
                ) : null}
              </div>
            ))}
          </details>
        ) : null}
      </SettingsGroup>
    </SettingsSection>
  );
}

export function CreateCircleAddRow({ onClick }: { onClick: () => void }) {
  return (
    <SettingsRowButton action ariaLabel="Create a circle" onClick={onClick}>
      <SettingsAvatar add />
      <SettingsRowCopy title="Create a circle" />
    </SettingsRowButton>
  );
}

export function CircleSettingsSheet({
  circle,
  onClose,
  busy,
  children,
}: {
  circle: FamilyCircleViewModel;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <CircleManagementSheet
      labelledBy="circle-settings-heading"
      onClose={onClose}
      busy={busy}
    >
      <section
        id="circle-settings"
        className="circle-rename-section"
        aria-label="Circle settings"
        aria-labelledby="circle-settings-heading"
      >
        <span>Circle settings</span>
        <h3 id="circle-settings-heading" tabIndex={-1}>
          {circle.name}
        </h3>
        {children}
      </section>
    </CircleManagementSheet>
  );
}

export function AddExistingMemberSheet({
  circle,
  groups,
  preview,
  actions,
  onClose,
}: {
  circle: FamilyCircleViewModel;
  groups: readonly FamilyCircleViewModel[];
  preview?: boolean;
  actions?: ExistingMemberActions;
  onClose: () => void;
}) {
  const sources = groups.filter(
    (group) => group.id !== circle.id && group.canManageAccess,
  );
  return (
    <CircleManagementSheet labelledBy="add-existing-heading" onClose={onClose}>
      <section aria-labelledby="add-existing-heading">
        <span>Add from a circle</span>
        <h3 id="add-existing-heading" tabIndex={-1}>
          {circle.name}
        </h3>
        <AddExistingMemberForm
          circle={circle}
          sources={sources}
          preview={preview}
          actions={actions}
        />
      </section>
    </CircleManagementSheet>
  );
}

export function CreateCircleSheet({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <CircleManagementSheet labelledBy="create-circle-heading" onClose={onClose}>
      <section aria-labelledby="create-circle-heading">
        <span>New circle</span>
        <h3 id="create-circle-heading" tabIndex={-1}>
          Create a circle
        </h3>
        <p className="chrome-body">
          A circle is a group of people who share one journal. You can invite
          people after it’s created.
        </p>
        {children}
      </section>
    </CircleManagementSheet>
  );
}
