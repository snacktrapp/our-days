"use client";

import { flushSync } from "react-dom";
import { InvitationDrawer } from "./invitation-drawer";

import { ArchiveCircleControl } from "@/features/groups/archive-circle-control";
import { CircleManagementSheet } from "./circle-management-sheet";
import {
  AddExistingMemberSheet,
  CircleDirectory,
  CircleSettingsSheet,
  CreateCircleAddRow,
  CreateCircleSheet,
} from "./circles-directory";
import { SettingsPage } from "./settings-directory";

import {
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type { ExistingMemberActions } from "./add-existing-member";
import type { FamilySettingsActionResult } from "./family-settings-actions";
import { AccountPanelInterrupted } from "@/features/shell/journal-interrupted";
import { countFamilyFacingMembers } from "@/lib/circle-roles";
import type {
  ConnectedFamilySettingsPanelViewModel,
  FamilyAccessMemberViewModel,
  FamilyCircleViewModel,
  FamilySettingsPanelViewModel,
  GuardianOptionViewModel,
  PendingFamilyInvitationViewModel,
  PreviewFamilySettingsPanelViewModel,
} from "./family-settings-view-model";

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

type CreateGroupActionResult = Readonly<
  { ok: true; href: string } | { ok: false; message: string }
>;

type RenameCircleActionResult = Readonly<
  { ok: true; message: string } | { ok: false; message: string }
>;

type ConnectedActions = Readonly<{
  existingMembers?: ExistingMemberActions;
  requestInvitation?: (input: {
    displayName: string;
    email: string;
    requestKey: string;
    circleId?: string;
  }) => Promise<FamilySettingsActionResult>;
  revokeMembership: (input: {
    membershipId: string;
    circleId?: string;
  }) => Promise<FamilySettingsActionResult>;
  withdrawInvitation: (input: {
    emailRequestId: string;
    circleId?: string;
  }) => Promise<FamilySettingsActionResult>;
  setMembershipRole: (input: {
    membershipId: string;
    role: "member" | "organizer";
    circleId?: string;
  }) => Promise<FamilySettingsActionResult>;
  setGuardian: (input: {
    managedPersonId: string;
    guardianMembershipId: string;
    grantAccess: boolean;
    circleId?: string;
  }) => Promise<FamilySettingsActionResult>;
}>;

export function FamilySettingsPanel({
  model,
  actions,
  createGroupAction,
  renameCircleAction,
  inviteCircleId,
  inviteCircleName,
  defaultCircleId,
  children,
}: {
  model: FamilySettingsPanelViewModel;
  actions?: ConnectedActions;
  createGroupAction?: (input: FormData) => Promise<CreateGroupActionResult>;
  renameCircleAction?: (input: FormData) => Promise<RenameCircleActionResult>;
  inviteCircleId?: string;
  inviteCircleName?: string;
  defaultCircleId?: string;
  children?: ReactNode;
}) {
  void inviteCircleName;
  if (model.mode === "preview") {
    return (
      <PreviewFamilySettingsPanel
        model={model}
        createGroupAction={createGroupAction}
        renameCircleAction={renameCircleAction}
        inviteCircleId={inviteCircleId}
        defaultCircleId={defaultCircleId}
      >
        {children}
      </PreviewFamilySettingsPanel>
    );
  }
  if (
    !actions ||
    (model.invitationDelivery === "enabled" && !actions.requestInvitation)
  ) {
    return <AccountPanelInterrupted>{children}</AccountPanelInterrupted>;
  }
  return (
    <ConnectedFamilySettingsPanel
      model={model}
      actions={actions}
      createGroupAction={createGroupAction}
      renameCircleAction={renameCircleAction}
      inviteCircleId={inviteCircleId}
      defaultCircleId={defaultCircleId}
    >
      {children}
    </ConnectedFamilySettingsPanel>
  );
}

function findMemberInGroups(
  groups: readonly FamilyCircleViewModel[],
  memberId: string | null,
) {
  if (!memberId) return null;
  for (const circle of groups) {
    const member = circle.members.find((item) => item.id === memberId);
    if (member) return { circle, member };
  }
  return null;
}

function isFirstMembersEmptyCircle(circle: FamilyCircleViewModel | undefined) {
  if (!circle) return false;
  return (
    countFamilyFacingMembers(circle.members) <= 1 &&
    (circle.pendingInvitations?.length ?? 0) === 0
  );
}

function shouldPromptFirstMembers(
  circle: FamilyCircleViewModel | null,
  inviteCircleId?: string,
) {
  return Boolean(
    inviteCircleId &&
    circle &&
    circle.id === inviteCircleId &&
    isFirstMembersEmptyCircle(circle),
  );
}

function RenameCircleForm({
  circle,
  renameCircleAction,
  disabled,
  onResult,
}: {
  circle: FamilyCircleViewModel;
  renameCircleAction?: (input: FormData) => Promise<RenameCircleActionResult>;
  disabled?: boolean;
  onResult?: (result: RenameCircleActionResult) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(circle.name);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const nameId = `rename-circle-name-${circle.id}`;

  if (!circle.canManageAccess) return null;

  return (
    <>
      {circle.canRename && renameCircleAction ? (
        <form
          action={(formData) => {
            startTransition(async () => {
              const result = await renameCircleAction(formData);
              if (!result.ok) {
                setError(result.message);
                onResult?.(result);
                return;
              }
              setError("");
              onResult?.(result);
              router.refresh();
            });
          }}
        >
          <input type="hidden" name="circleId" value={circle.id} />
          <label htmlFor={nameId}>Circle name</label>
          <input
            id={nameId}
            name="name"
            required
            maxLength={80}
            autoComplete="off"
            value={name}
            disabled={disabled || pending}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError("");
            }}
          />
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={disabled || pending}>
            {pending ? "Saving…" : "Save name"}
          </button>
        </form>
      ) : null}
      <ArchiveCircleControl
        circleId={circle.id}
        name={circle.name}
        disabled={disabled || pending}
      />
    </>
  );
}

function CreateGroupCard({
  createGroupAction,
  groups,
  defaultCircleId,
}: {
  createGroupAction?: (input: FormData) => Promise<CreateGroupActionResult>;
  groups: readonly FamilyCircleViewModel[];
  defaultCircleId?: string;
}) {
  const initialSourceId =
    groups.find((group) => group.id === defaultCircleId)?.id ??
    groups[0]?.id ??
    "";
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sourceCircleId = initialSourceId;
  const [name, setName] = useState("");
  if (!createGroupAction) return null;

  return (
    <form
      className="wider-circle-form"
      action={(formData) => {
        startTransition(async () => {
          setError(null);
          const result = await createGroupAction(formData);
          if (result && !result.ok) setError(result.message);
        });
      }}
    >
      <input type="hidden" name="sourceCircleId" value={sourceCircleId} />

      <label htmlFor="create-group-name">Name</label>
      <input
        id="create-group-name"
        name="name"
        required
        maxLength={80}
        autoComplete="off"
        value={name}
        disabled={pending}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
      />
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create circle"}
      </button>
    </form>
  );
}

function PreviewFamilySettingsPanel({
  model,
  createGroupAction,
  renameCircleAction,
  inviteCircleId,
  defaultCircleId,
  children,
}: {
  model: PreviewFamilySettingsPanelViewModel;
  createGroupAction?: (input: FormData) => Promise<CreateGroupActionResult>;
  renameCircleAction?: (input: FormData) => Promise<RenameCircleActionResult>;
  inviteCircleId?: string;
  defaultCircleId?: string;
  children?: ReactNode;
}) {
  const [email, setEmail] = useState("");
  const [reviewEmail, setReviewEmail] = useState<string | null>(null);
  const [emailError, setEmailError] = useState("");
  const [accessReviewId, setAccessReviewId] = useState<string | null>(null);
  const [circleSettingsId, setCircleSettingsId] = useState<string | null>(null);
  const [addExistingCircleId, setAddExistingCircleId] = useState<string | null>(
    null,
  );
  const [createCircleOpen, setCreateCircleOpen] = useState(false);
  const [inviteCircleIdState, setInviteCircleIdState] = useState<string | null>(
    () => {
      const circle =
        model.groups.find((group) => group.id === inviteCircleId) ??
        model.groups[0];
      if (
        inviteCircleId &&
        circle &&
        !isFirstMembersEmptyCircle(circle)
      ) {
        return inviteCircleId;
      }
      return null;
    },
  );
  const emailRef = useRef<HTMLInputElement>(null);
  const restoreInviteFocusRef = useRef(false);
  const accessTriggerRef = useRef<HTMLButtonElement>(null);
  const accessHeadingRef = useRef<HTMLHeadingElement>(null);
  const inviteReviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const firstMembersCtaRef = useRef<HTMLButtonElement>(null);
  const inviteCircle =
    model.groups.find((group) => group.id === inviteCircleIdState) ?? null;
  const inviteTargetCircle =
    model.groups.find((group) => group.id === inviteCircleId) ?? null;
  const accessReviewMember = findMemberInGroups(model.groups, accessReviewId)
    ?.member;
  const promptFirstMembers = shouldPromptFirstMembers(
    inviteTargetCircle,
    inviteCircleId,
  );

  useEffect(() => {
    if (reviewEmail) {
      inviteReviewHeadingRef.current?.focus();
      return;
    }
    if (!restoreInviteFocusRef.current) return;
    emailRef.current?.focus();
    restoreInviteFocusRef.current = false;
  }, [reviewEmail]);

  useEffect(() => {
    if (accessReviewId) accessHeadingRef.current?.focus();
  }, [accessReviewId]);

  useEffect(() => {
    if (promptFirstMembers && !inviteCircleIdState) {
      firstMembersCtaRef.current?.focus();
    }
  }, [promptFirstMembers, inviteCircleIdState]);

  useEffect(() => {
    if (inviteCircleIdState && promptFirstMembers) {
      emailRef.current?.focus();
    }
  }, [inviteCircleIdState, promptFirstMembers]);

  function previewInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = email.trim();
    if (!SIMPLE_EMAIL.test(candidate)) {
      setEmailError("Enter a complete email address.");
      emailRef.current?.focus();
      return;
    }
    setEmailError("");
    setReviewEmail(candidate);
  }

  function returnToInviteEdit() {
    restoreInviteFocusRef.current = true;
    setReviewEmail(null);
  }

  function clearInvitePreview() {
    restoreInviteFocusRef.current = true;
    setReviewEmail(null);
    setEmail("");
    setEmailError("");
  }

  return (
    <SettingsPage className="family-settings-panel">
      <p className="settings-preview-banner">
        Preview only · No accounts or access are changed.
      </p>

      <CircleDirectory
        groups={model.groups}
        mode="preview"
        reviewId={accessReviewId}
        invitationReviewId={null}
        accessTriggerRef={accessTriggerRef}
        invitationTriggerRef={accessTriggerRef}
        inviteCircleId={inviteCircleId}
        promptFirstMembers={promptFirstMembers}
        inviteCtaRef={firstMembersCtaRef}
        circleSettingsId={circleSettingsId}
        addExistingCircleId={addExistingCircleId}
        onManageMember={(memberId) =>
          setAccessReviewId((current) => (current === memberId ? null : memberId))
        }
        onManageInvitation={() => undefined}
        onInvite={(circle) => {
          flushSync(() => setInviteCircleIdState(circle.id));
          document
            .querySelector<HTMLInputElement>("#invitation-drawer input")
            ?.focus();
        }}
        onOpenCircleSettings={(circleId) =>
          setCircleSettingsId((current) =>
            current === circleId ? null : circleId,
          )
        }
        onOpenAddExisting={(circleId) =>
          setAddExistingCircleId((current) =>
            current === circleId ? null : circleId,
          )
        }
        renderCircleSettings={(circle) => (
          <CircleSettingsSheet
            circle={circle}
            onClose={() => setCircleSettingsId(null)}
          >
            <RenameCircleForm
              key={`${circle.id}:${circle.name}`}
              circle={circle}
              renameCircleAction={renameCircleAction}
            />
          </CircleSettingsSheet>
        )}
        renderAddExisting={(circle) => (
          <AddExistingMemberSheet
            circle={circle}
            groups={model.groups}
            preview
            onClose={() => setAddExistingCircleId(null)}
          />
        )}
      >
        <CreateCircleAddRow onClick={() => setCreateCircleOpen(true)} />
      </CircleDirectory>

      {accessReviewMember ? (
        <CircleManagementSheet
          labelledBy="access-review-heading"
          onClose={() => {
            setAccessReviewId(null);
            accessTriggerRef.current?.focus();
          }}
        >
          <aside
            id="access-review"
            className="access-review"
            aria-labelledby="access-review-heading"
          >
            <span>Removal preview</span>
            <h3
              ref={accessHeadingRef}
              id="access-review-heading"
              tabIndex={-1}
            >
              Review {accessReviewMember.name}’s access
            </h3>
            <RemovalConsequences preview />
            <p className="preview-honesty">
              Local design preview · No access is changed
            </p>
            <button
              type="button"
              onClick={() => {
                setAccessReviewId(null);
                accessTriggerRef.current?.focus();
              }}
            >
              Close review
            </button>
          </aside>
        </CircleManagementSheet>
      ) : null}

      {inviteCircle ? (
        <InvitationDrawer
          circleName={inviteCircle.name}
          onClose={() => setInviteCircleIdState(null)}
        >
          {reviewEmail ? (
            <div className="invite-review">
              <span>Invitation preview</span>
              <h3 ref={inviteReviewHeadingRef} tabIndex={-1}>
                {reviewEmail}
              </h3>
              <InvitationConsequences />
              <p className="preview-honesty">
                Local design preview · Our Days did not send email or create an
                invite
              </p>
              <div>
                <button type="button" onClick={returnToInviteEdit}>
                  Back to edit
                </button>
                <button type="button" onClick={clearInvitePreview}>
                  Clear preview
                </button>
              </div>
            </div>
          ) : (
            <form noValidate onSubmit={previewInvite}>
              <label htmlFor="family-invite-email">Email address</label>
              <input
                ref={emailRef}
                id="family-invite-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={
                  emailError ? "family-invite-error" : "family-invite-help"
                }
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (emailError) setEmailError("");
                }}
              />
              {emailError ? (
                <p
                  id="family-invite-error"
                  className="field-error"
                  role="alert"
                >
                  {emailError}
                </p>
              ) : (
                <p id="family-invite-help">
                  You can review the address before anything is sent.
                </p>
              )}
              <button type="submit">Review invitation</button>
              <small>
                Local design preview · Our Days does not send or save this
                preview
              </small>
            </form>
          )}
        </InvitationDrawer>
      ) : null}

      {createCircleOpen && createGroupAction ? (
        <CreateCircleSheet onClose={() => setCreateCircleOpen(false)}>
          <CreateGroupCard
            createGroupAction={createGroupAction}
            groups={model.groups}
            defaultCircleId={defaultCircleId}
          />
        </CreateCircleSheet>
      ) : null}
      {children}
    </SettingsPage>
  );
}

function ConnectedFamilySettingsPanel({
  model,
  actions,
  createGroupAction,
  renameCircleAction,
  inviteCircleId,
  defaultCircleId,
  children,
}: {
  model: ConnectedFamilySettingsPanelViewModel;
  actions: ConnectedActions;
  createGroupAction?: (input: FormData) => Promise<CreateGroupActionResult>;
  renameCircleAction?: (input: FormData) => Promise<RenameCircleActionResult>;
  inviteCircleId?: string;
  defaultCircleId?: string;
  children?: ReactNode;
}) {
  const [accessReviewId, setAccessReviewId] = useState<string | null>(null);
  const [invitationReviewId, setInvitationReviewId] = useState<string | null>(
    null,
  );
  const [circleSettingsId, setCircleSettingsId] = useState<string | null>(null);
  const [addExistingCircleId, setAddExistingCircleId] = useState<string | null>(
    null,
  );
  const [createCircleOpen, setCreateCircleOpen] = useState(false);
  const [inviteCircleIdState, setInviteCircleIdState] = useState<string | null>(
    () => {
      const circle =
        model.groups.find((group) => group.id === inviteCircleId) ??
        model.groups[0];
      if (
        inviteCircleId &&
        circle &&
        !isFirstMembersEmptyCircle(circle)
      ) {
        return inviteCircleId;
      }
      return null;
    },
  );
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFormError, setInviteFormError] = useState("");
  const [inviteFormErrorField, setInviteFormErrorField] = useState<
    "name" | "email" | null
  >(null);
  const [inviteDraft, setInviteDraft] = useState<Readonly<{
    displayName: string;
    email: string;
  }> | null>(null);
  const [result, setResult] = useState<FamilySettingsActionResult | null>(null);
  const [optimisticPending, setOptimisticPending] = useState<
    readonly PendingFamilyInvitationViewModel[]
  >([]);
  const [isPending, startTransition] = useTransition();
  const accessTriggerRef = useRef<HTMLButtonElement>(null);
  const invitationTriggerRef = useRef<HTMLButtonElement>(null);
  const accessHeadingRef = useRef<HTMLHeadingElement>(null);
  const invitationHeadingRef = useRef<HTMLHeadingElement>(null);
  const inviteNameRef = useRef<HTMLInputElement>(null);
  const inviteEmailRef = useRef<HTMLInputElement>(null);
  const inviteDraftHeadingRef = useRef<HTMLHeadingElement>(null);
  const inviteRequestKeyRef = useRef<string | null>(null);
  const restoreInviteFormFocusRef = useRef(false);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const firstMembersCtaRef = useRef<HTMLButtonElement>(null);
  const inviteCircle =
    model.groups.find((group) => group.id === inviteCircleIdState) ?? null;
  const accessReview = findMemberInGroups(model.groups, accessReviewId);
  const accessReviewMember = accessReview?.member;
  const accessReviewCircle = accessReview?.circle;
  const displayGroups = model.groups.map((circle) => {
    const listedNames = new Set(
      (circle.pendingInvitations ?? []).map((item) =>
        item.displayName.trim().toLowerCase(),
      ),
    );
    const extra =
      circle.id === inviteCircleIdState
        ? optimisticPending.filter(
            (item) =>
              !listedNames.has(item.displayName.trim().toLowerCase()),
          )
        : [];
    return {
      ...circle,
      pendingInvitations: [...(circle.pendingInvitations ?? []), ...extra],
    };
  });
  const invitationCircle = displayGroups.find((circle) =>
    (circle.pendingInvitations ?? []).some(
      (item) => item.emailRequestId === invitationReviewId,
    ),
  );
  const invitation = invitationCircle?.pendingInvitations?.find(
    (item) => item.emailRequestId === invitationReviewId,
  );
  const journalCareSuccess =
    result?.ok && accessReviewMember?.profileKind === "managed";
  const inviteTargetCircle =
    model.groups.find((group) => group.id === inviteCircleId) ?? null;
  const promptFirstMembers = shouldPromptFirstMembers(
    inviteTargetCircle,
    inviteCircleId,
  );

  useEffect(() => {
    if (accessReviewId) accessHeadingRef.current?.focus();
  }, [accessReviewId]);

  useEffect(() => {
    if (invitationReviewId) invitationHeadingRef.current?.focus();
  }, [invitationReviewId]);

  useEffect(() => {
    if (inviteDraft) {
      inviteDraftHeadingRef.current?.focus();
      return;
    }
    if (!restoreInviteFormFocusRef.current) return;
    inviteNameRef.current?.focus();
    restoreInviteFormFocusRef.current = false;
  }, [inviteDraft]);

  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  useEffect(() => {
    if (promptFirstMembers && !inviteCircleIdState) {
      firstMembersCtaRef.current?.focus();
    }
  }, [promptFirstMembers, inviteCircleIdState]);

  useEffect(() => {
    if (inviteCircleIdState && promptFirstMembers) {
      inviteNameRef.current?.focus();
    }
  }, [inviteCircleIdState, promptFirstMembers]);

  function closeAccessReview() {
    setAccessReviewId(null);
    accessTriggerRef.current?.focus();
  }

  function closeInvitationReview() {
    setInvitationReviewId(null);
    invitationTriggerRef.current?.focus();
  }

  function reviewInvitationRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = inviteName.trim();
    const email = inviteEmail.trim().toLowerCase();
    if (
      displayName.length < 1 ||
      Array.from(displayName).length > 80 ||
      CONTROL_CHARACTER.test(displayName)
    ) {
      setInviteFormError("Enter the member’s name.");
      setInviteFormErrorField("name");
      inviteNameRef.current?.focus();
      return;
    }
    if (
      !SIMPLE_EMAIL.test(email) ||
      email.length > 254 ||
      CONTROL_CHARACTER.test(email)
    ) {
      setInviteFormError("Enter a complete email address.");
      setInviteFormErrorField("email");
      inviteEmailRef.current?.focus();
      return;
    }
    setResult(null);
    setInviteFormError("");
    setInviteFormErrorField(null);
    setInviteName(displayName);
    setInviteEmail(email);
    setAccessReviewId(null);
    setInvitationReviewId(null);
    setInviteDraft({ displayName, email });
  }

  function resetInviteComposer() {
    restoreInviteFormFocusRef.current = true;
    setInviteDraft(null);
    setInviteName("");
    setInviteEmail("");
    setInviteFormError("");
    setInviteFormErrorField(null);
  }

  function editInvitationRequest() {
    restoreInviteFormFocusRef.current = true;
    inviteRequestKeyRef.current = null;
    setResult(null);
    setInviteDraft(null);
  }

  function sendInvitationRequest() {
    if (!inviteDraft || !actions.requestInvitation || !inviteCircle) return;
    const requestInvitation = actions.requestInvitation;
    const draft = inviteDraft;
    const requestKey =
      inviteRequestKeyRef.current ?? window.crypto.randomUUID();
    inviteRequestKeyRef.current = requestKey;
    const alreadyListed = (inviteCircle.pendingInvitations ?? []).some(
      (item) =>
        item.displayName.trim().toLowerCase() ===
        draft.displayName.trim().toLowerCase(),
    );
    setResult(null);
    resetInviteComposer();
    startTransition(async () => {
      try {
        const nextResult = await requestInvitation({
          ...draft,
          requestKey,
          circleId: inviteCircle.id,
        });
        if (nextResult.ok || alreadyListed) {
          inviteRequestKeyRef.current = null;
          if (!alreadyListed) {
            setOptimisticPending((current) => [
              ...current.filter(
                (item) =>
                  item.displayName.trim().toLowerCase() !==
                  draft.displayName.trim().toLowerCase(),
              ),
              {
                emailRequestId: `optimistic:${requestKey}`,
                displayName: draft.displayName,
                state: "queued",
                statusLabel: "Pending",
                createdLabel: "",
                expiresLabel: "",
              },
            ]);
          }
          return;
        }
        restoreInviteFormFocusRef.current = true;
        setInviteDraft(draft);
        setInviteName(draft.displayName);
        setInviteEmail(draft.email);
        setResult(nextResult);
      } catch {
        restoreInviteFormFocusRef.current = true;
        setInviteDraft(draft);
        setInviteName(draft.displayName);
        setInviteEmail(draft.email);
        setResult({
          ok: false,
          message: "That invitation could not be sent. Try again.",
        });
      }
    });
  }

  function removeAccess() {
    const membershipId = accessReviewMember?.membershipId;
    if (!membershipId || !accessReviewCircle) return;
    setResult(null);
    startTransition(async () => {
      try {
        const nextResult = await actions.revokeMembership({
          membershipId,
          circleId: accessReviewCircle.id,
        });
        setResult(
          nextResult.ok
            ? {
                ok: true,
                message: `${accessReviewMember.name} can no longer open this circle.`,
              }
            : nextResult,
        );
        if (nextResult.ok) setAccessReviewId(null);
      } catch {
        setResult({
          ok: false,
          message: "That access could not be removed. Try again.",
        });
      }
    });
  }

  function changeRole(role: "member" | "organizer") {
    const membershipId = accessReviewMember?.membershipId;
    if (!membershipId || !accessReviewCircle) return;
    setResult(null);
    startTransition(async () => {
      try {
        const nextResult = await actions.setMembershipRole({
          membershipId,
          role,
          circleId: accessReviewCircle.id,
        });
        setResult(
          nextResult.ok
            ? {
                ok: true,
                message:
                  role === "organizer"
                    ? `${accessReviewMember.name} is now an organizer.`
                    : `${accessReviewMember.name} is now a member.`,
              }
            : nextResult,
        );
        if (nextResult.ok) setAccessReviewId(null);
      } catch {
        setResult({
          ok: false,
          message: "That role could not be changed. Try again.",
        });
      }
    });
  }

  function changeGuardian(guardianMembershipId: string, grantAccess: boolean) {
    const managedPersonId = accessReviewMember?.id;
    if (
      !managedPersonId ||
      accessReviewMember.profileKind !== "managed" ||
      !accessReviewCircle
    ) {
      return;
    }
    setResult(null);
    startTransition(async () => {
      try {
        const guardianName = accessReviewCircle.guardianOptions.find(
          (guardian) => guardian.membershipId === guardianMembershipId,
        )?.name;
        const nextResult = await actions.setGuardian({
          managedPersonId,
          guardianMembershipId,
          grantAccess,
          circleId: accessReviewCircle.id,
        });
        setResult(
          nextResult.ok && guardianName
            ? {
                ok: true,
                message: grantAccess
                  ? `${guardianName} can now care for ${accessReviewMember.name}’s journal.`
                  : `${guardianName} no longer has care access to ${accessReviewMember.name}’s journal.`,
              }
            : nextResult,
        );
      } catch {
        setResult({
          ok: false,
          message: "That journal care could not be changed. Try again.",
        });
      }
    });
  }

  function withdrawInvitation() {
    if (!invitation || !invitationCircle) return;
    const emailRequestId = invitation.emailRequestId;
    setResult(null);
    startTransition(async () => {
      try {
        const nextResult = await actions.withdrawInvitation({
          emailRequestId,
          circleId: invitationCircle.id,
        });
        setResult(
          nextResult.ok
            ? {
                ok: true,
                message: `${invitation.displayName}’s invitation was withdrawn.`,
              }
            : nextResult,
        );
        if (nextResult.ok) setInvitationReviewId(null);
      } catch {
        setResult({
          ok: false,
          message: "That invitation could not be withdrawn. Try again.",
        });
      }
    });
  }

  const inviteDrawer = inviteCircle ? (
    <InvitationDrawer
      circleName={inviteCircle.name}
      pending={isPending}
      onClose={() => setInviteCircleIdState(null)}
    >
      {inviteCircle.canManageAccess ? (
        <>
          {model.invitationDelivery === "enabled" ? (
            inviteDraft ? (
              <aside
                className="invite-review connected-invite-request-review"
                aria-labelledby="invitation-request-review-heading"
              >
                <span>Review invitation</span>
                <h3
                  ref={inviteDraftHeadingRef}
                  id="invitation-request-review-heading"
                  tabIndex={-1}
                >
                  Invite {inviteDraft.displayName}
                </h3>
                <p className="invite-review-email">{inviteDraft.email}</p>
                <InvitationConsequences />
                {result && !result.ok ? (
                  <p
                    ref={resultRef}
                    className="settings-action-message settings-action-error settings-inline-message"
                    role="alert"
                    tabIndex={-1}
                  >
                    {result.message}
                  </p>
                ) : null}
                <div className="settings-review-actions">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={editInvitationRequest}
                  >
                    Back to edit
                  </button>
                  <button
                    type="button"
                    aria-busy={isPending || undefined}
                    disabled={isPending}
                    onClick={sendInvitationRequest}
                  >
                    {isPending ? "Sending…" : "Send private invitation"}
                  </button>
                </div>
              </aside>
            ) : (
              <form
                className="connected-invite-form"
                noValidate
                onSubmit={reviewInvitationRequest}
              >
                <label htmlFor="connected-family-invite-name">
                  Member’s name
                </label>
                <input
                  ref={inviteNameRef}
                  id="connected-family-invite-name"
                  name="displayName"
                  type="text"
                  autoComplete="off"
                  maxLength={80}
                  required
                  disabled={isPending}
                  value={inviteName}
                  aria-invalid={
                    inviteFormErrorField === "name" ? true : undefined
                  }
                  aria-describedby={
                    inviteFormErrorField === "name"
                      ? "connected-family-invite-error"
                      : undefined
                  }
                  onChange={(event) => {
                    setInviteName(event.target.value);
                    setInviteFormError("");
                    setInviteFormErrorField(null);
                  }}
                />
                <label htmlFor="connected-family-invite-email">
                  Email address
                </label>
                <input
                  ref={inviteEmailRef}
                  id="connected-family-invite-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  disabled={isPending}
                  value={inviteEmail}
                  aria-invalid={
                    inviteFormErrorField === "email" ? true : undefined
                  }
                  aria-describedby={
                    inviteFormErrorField === "email"
                      ? "connected-family-invite-error"
                      : "connected-family-invite-help"
                  }
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                    setInviteFormError("");
                    setInviteFormErrorField(null);
                  }}
                />
                {inviteFormError ? (
                  <p
                    id="connected-family-invite-error"
                    className="field-error"
                    role="alert"
                  >
                    {inviteFormError}
                  </p>
                ) : (
                  <p id="connected-family-invite-help">
                    You can review both details before anything is sent.
                  </p>
                )}
                <button type="submit" disabled={isPending}>
                  Review invitation
                </button>
              </form>
            )
          ) : null}
          {model.invitationDelivery === "disabled" ? (
            <div className="settings-delivery-boundary">
              <strong>Invitations are unavailable right now.</strong>
            </div>
          ) : null}
        </>
      ) : null}
    </InvitationDrawer>
  ) : null;

  return (
    <SettingsPage className="family-settings-panel">
      {result?.ok && !journalCareSuccess ? (
        <p
          ref={resultRef}
          className="settings-action-message"
          role="status"
          tabIndex={-1}
        >
          {result.message}
        </p>
      ) : null}

      <CircleDirectory
        groups={displayGroups}
        mode="connected"
        reviewId={accessReviewId}
        invitationReviewId={invitationReviewId}
        disabled={isPending}
        accessTriggerRef={accessTriggerRef}
        invitationTriggerRef={invitationTriggerRef}
        inviteCircleId={inviteCircleId}
        promptFirstMembers={promptFirstMembers}
        inviteCtaRef={firstMembersCtaRef}
        circleSettingsId={circleSettingsId}
        addExistingCircleId={addExistingCircleId}
        existingMemberActions={actions.existingMembers}
        onManageMember={(memberId) => {
          setResult(null);
          setInvitationReviewId(null);
          setAccessReviewId((current) =>
            current === memberId ? null : memberId,
          );
        }}
        onManageInvitation={(emailRequestId) => {
          setResult(null);
          setInviteDraft(null);
          setInvitationReviewId((current) =>
            current === emailRequestId ? null : emailRequestId,
          );
        }}
        onInvite={(circle) => {
          flushSync(() => setInviteCircleIdState(circle.id));
          document
            .querySelector<HTMLInputElement>("#invitation-drawer input")
            ?.focus();
        }}
        onOpenCircleSettings={(circleId) =>
          setCircleSettingsId((current) =>
            current === circleId ? null : circleId,
          )
        }
        onOpenAddExisting={(circleId) =>
          setAddExistingCircleId((current) =>
            current === circleId ? null : circleId,
          )
        }
        renderCircleSettings={(circle) => (
          <CircleSettingsSheet
            circle={circle}
            onClose={() => setCircleSettingsId(null)}
            busy={isPending}
          >
            <RenameCircleForm
              key={`${circle.id}:${circle.name}`}
              circle={circle}
              renameCircleAction={renameCircleAction}
              disabled={isPending}
              onResult={setResult}
            />
          </CircleSettingsSheet>
        )}
        renderAddExisting={(circle) => (
          <AddExistingMemberSheet
            circle={circle}
            groups={model.groups}
            actions={actions.existingMembers}
            onClose={() => setAddExistingCircleId(null)}
          />
        )}
      >
        <CreateCircleAddRow onClick={() => setCreateCircleOpen(true)} />
      </CircleDirectory>

      {accessReviewMember && accessReviewCircle ? (
        <CircleManagementSheet
          labelledBy="access-review-heading"
          onClose={closeAccessReview}
          busy={isPending}
        >
          <aside
            id="access-review"
            className="access-review"
            aria-labelledby="access-review-heading"
          >
            <span>
              {accessReviewMember.profileKind === "managed"
                ? "Journal care"
                : "Role and access"}
            </span>
            <h3
              ref={accessHeadingRef}
              id="access-review-heading"
              tabIndex={-1}
            >
              {accessReviewMember.profileKind === "managed"
                ? `Care for ${accessReviewMember.name}’s journal`
                : `Manage ${accessReviewMember.name}`}
            </h3>
            {accessReviewMember.profileKind === "managed" ? (
              <JournalCareReview
                member={accessReviewMember}
                guardianOptions={accessReviewCircle.guardianOptions}
                disabled={isPending}
                onChange={changeGuardian}
              />
            ) : (
              <AccountRoleReview
                member={accessReviewMember}
                managedProfiles={accessReviewCircle.members.filter(
                  (member) => member.profileKind === "managed",
                )}
                disabled={isPending}
                onChangeRole={changeRole}
              />
            )}
            {journalCareSuccess ? (
              <p
                ref={resultRef}
                className="settings-action-message settings-inline-message"
                role="status"
                tabIndex={-1}
              >
                {result.message}
              </p>
            ) : null}
            {result && !result.ok ? (
              <p
                ref={resultRef}
                className="settings-action-message settings-action-error"
                role="alert"
                tabIndex={-1}
              >
                {result.message}
              </p>
            ) : null}
            {accessReviewMember.profileKind === "account" ? (
              <div className="settings-removal-zone">
                <RemovalConsequences />
                <p className="settings-confirmation-copy">
                  This takes effect immediately, including access to managed
                  journals in this circle.
                </p>
                <button
                  type="button"
                  aria-label={`Remove access for ${accessReviewMember.name}`}
                  aria-busy={isPending || undefined}
                  className="settings-danger-button"
                  disabled={isPending}
                  onClick={removeAccess}
                >
                  Remove access
                </button>
              </div>
            ) : null}
            <div className="settings-review-actions settings-review-close">
              <button type="button" disabled={isPending} onClick={closeAccessReview}>
                Done
              </button>
            </div>
          </aside>
        </CircleManagementSheet>
      ) : null}

      {invitation ? (
        <CircleManagementSheet
          labelledBy="invitation-review-heading"
          onClose={closeInvitationReview}
          busy={isPending}
        >
          <aside
            id="invitation-review"
            className="invite-review connected-invite-review"
            aria-labelledby="invitation-review-heading"
          >
            <span>Withdraw invitation</span>
            <h3
              ref={invitationHeadingRef}
              id="invitation-review-heading"
              tabIndex={-1}
            >
              Review {invitation.displayName}’s invitation
            </h3>
            <p>
              Withdrawing it prevents this invitation from being accepted. It
              does not change access for anyone already in the circle.
            </p>
            {result && !result.ok ? (
              <p
                ref={resultRef}
                className="settings-action-message settings-action-error"
                role="alert"
                tabIndex={-1}
              >
                {result.message}
              </p>
            ) : null}
            <div className="settings-review-actions">
              <button
                type="button"
                disabled={isPending}
                onClick={closeInvitationReview}
              >
                Keep invitation
              </button>
              <button
                type="button"
                aria-label={`Withdraw invitation for ${invitation.displayName}`}
                aria-busy={isPending || undefined}
                className="settings-danger-button"
                disabled={isPending}
                onClick={withdrawInvitation}
              >
                Withdraw invitation
              </button>
            </div>
          </aside>
        </CircleManagementSheet>
      ) : null}

      {inviteDrawer}

      {createCircleOpen && createGroupAction ? (
        <CreateCircleSheet onClose={() => setCreateCircleOpen(false)}>
          <CreateGroupCard
            createGroupAction={createGroupAction}
            groups={model.groups}
            defaultCircleId={defaultCircleId}
          />
        </CreateCircleSheet>
      ) : null}
      {children}
    </SettingsPage>
  );
}

function AccountRoleReview({
  member,
  managedProfiles,
  disabled,
  onChangeRole,
}: Readonly<{
  member: FamilyAccessMemberViewModel;
  managedProfiles: readonly FamilyAccessMemberViewModel[];
  disabled: boolean;
  onChangeRole: (role: "member" | "organizer") => void;
}>) {
  if (!member.membershipId || !member.role) return null;
  const membershipId = member.membershipId;
  const assignedJournals = managedProfiles.filter((profile) =>
    profile.guardianMembershipIds.includes(membershipId),
  );
  if (member.role === "operations") {
    return (
      <div className="settings-role-card">
        <strong>Current role: Operations</strong>
        <p>
          Operations has organizer access and does not appear in the journal.
        </p>
      </div>
    );
  }
  const nextRole = member.role === "organizer" ? "member" : "organizer";

  return (
    <div className="settings-role-card">
      <strong>
        Current role: {member.role === "organizer" ? "Organizer" : "Member"}
      </strong>
      {nextRole === "organizer" ? (
        <p>
          Organizers manage members and access to managed journals. They cannot
          edit another account’s posts.
        </p>
      ) : (
        <p>
          {member.name} will keep circle access but lose organizer controls and
          automatic access to managed journals.
          {assignedJournals.length
            ? ` Assigned access to ${assignedJournals.map((profile) => profile.name).join(", ")} will remain.`
            : ""}
        </p>
      )}
      <button
        type="button"
        aria-label={
          nextRole === "organizer"
            ? `Make organizer: ${member.name}`
            : `Change to member: ${member.name}`
        }
        aria-busy={disabled || undefined}
        disabled={disabled}
        onClick={() => onChangeRole(nextRole)}
      >
        {nextRole === "organizer" ? "Make organizer" : "Change to member"}
      </button>
    </div>
  );
}

function JournalCareReview({
  member,
  guardianOptions,
  disabled,
  onChange,
}: Readonly<{
  member: FamilyAccessMemberViewModel;
  guardianOptions: readonly GuardianOptionViewModel[];
  disabled: boolean;
  onChange: (membershipId: string, grantAccess: boolean) => void;
}>) {
  return (
    <>
      <p className="settings-confirmation-copy">
        Organizers have access to all managed journals. Assigned caregivers
        retain access even without organizer controls.
      </p>
      <fieldset className="guardian-options">
        <legend>Assigned caregivers</legend>
        <ul>
          {guardianOptions.map((guardian) => {
            const assigned = member.guardianMembershipIds.includes(
              guardian.membershipId,
            );
            return (
              <li key={guardian.membershipId}>
                <span>
                  <strong>{guardian.name}</strong>
                  <small>
                    {guardian.role === "organizer"
                      ? assigned
                        ? "Organizer · assignment stays if their role changes"
                        : "Organizer · already has care access"
                      : assigned
                        ? "Member · assigned caregiver"
                        : "Member · no care access"}
                  </small>
                </span>
                <button
                  type="button"
                  aria-label={`${assigned ? "Remove" : "Assign"} ${guardian.name} as caregiver for ${member.name}`}
                  aria-busy={disabled || undefined}
                  disabled={disabled}
                  onClick={() => onChange(guardian.membershipId, !assigned)}
                >
                  {assigned ? "Remove" : "Assign"}
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </>
  );
}

function RemovalConsequences({ preview = false }: { preview?: boolean }) {
  if (preview) {
    return (
      <p>
        This person would lose access to this circle. Their account and existing
        posts would remain.
      </p>
    );
  }
  return (
    <p>
      This person will lose access to this circle. Their account and existing
      posts will remain.
    </p>
  );
}

function InvitationConsequences() {
  return (
    <p>
      They’ll be able to see and contribute to this circle. They won’t have
      organizer controls.
    </p>
  );
}
