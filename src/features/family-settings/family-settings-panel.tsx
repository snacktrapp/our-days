"use client";

import {
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import type { FamilySettingsActionResult } from "./family-settings-actions";
import { AccountPanelInterrupted } from "@/features/shell/journal-interrupted";
import {
  isWiderCircleNameSuggestion,
  normalizeWiderCirclePerson,
  suggestWiderCircleName,
} from "@/features/groups/wider-circle";
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

type ConnectedActions = Readonly<{
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
  inviteCircleId,
  inviteCircleName,
  defaultCircleId,
  skipFirstMembers,
  children,
}: {
  model: FamilySettingsPanelViewModel;
  actions?: ConnectedActions;
  createGroupAction?: (input: FormData) => Promise<CreateGroupActionResult>;
  inviteCircleId?: string;
  inviteCircleName?: string;
  defaultCircleId?: string;
  skipFirstMembers?: boolean;
  children?: ReactNode;
}) {
  void inviteCircleName;
  if (model.mode === "preview") {
    return (
      <PreviewFamilySettingsPanel
        model={model}
        createGroupAction={createGroupAction}
        inviteCircleId={inviteCircleId}
        defaultCircleId={defaultCircleId}
        skipFirstMembers={skipFirstMembers}
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
      inviteCircleId={inviteCircleId}
      defaultCircleId={defaultCircleId}
      skipFirstMembers={skipFirstMembers}
    >
      {children}
    </ConnectedFamilySettingsPanel>
  );
}

function pendingInitial(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
}

function peopleCountLabel(count: number) {
  return count === 1 ? "1 person" : `${count} people`;
}

function isFirstMembersEmptyCircle(circle: FamilyCircleViewModel) {
  return (
    circle.memberCount <= 1 && (circle.pendingInvitations?.length ?? 0) === 0
  );
}

function shouldPromptFirstMembers(
  circle: FamilyCircleViewModel | null,
  inviteCircleId?: string,
  skipFirstMembers?: boolean,
) {
  return Boolean(
    !skipFirstMembers &&
    inviteCircleId &&
    circle &&
    circle.id === inviteCircleId &&
    isFirstMembersEmptyCircle(circle),
  );
}

function FirstMembersInvitePrompt({
  circleName,
  onAdd,
  ctaRef,
}: {
  circleName: string;
  onAdd: () => void;
  ctaRef: MutableRefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="first-members-prompt">
      <div className="settings-heading">
        <span>New circle</span>
        <h3 id="invite-heading">Add your first members</h3>
        <p>Invite someone into {circleName}.</p>
      </div>
      <button type="button" ref={ctaRef} onClick={onAdd}>
        Add your first members
      </button>
    </div>
  );
}

function MemberList({
  members,
  currentMemberId,
  mode,
  reviewId,
  setReviewId,
  triggerRef,
  disabled = false,
  pendingInvitations = [],
  invitationReviewId = null,
  setInvitationReviewId,
  invitationTriggerRef,
}: {
  members: readonly FamilyAccessMemberViewModel[];
  currentMemberId: string;
  mode: "preview" | "connected";
  reviewId: string | null;
  setReviewId: (id: string | null) => void;
  triggerRef: MutableRefObject<HTMLButtonElement | null>;
  disabled?: boolean;
  pendingInvitations?: readonly PendingFamilyInvitationViewModel[];
  invitationReviewId?: string | null;
  setInvitationReviewId?: (id: string | null) => void;
  invitationTriggerRef?: MutableRefObject<HTMLButtonElement | null>;
}) {
  return (
    <ul className="access-list">
      {members.map((member) => (
        <li key={member.id}>
          <span
            className={`person-avatar dot-${member.accent}`}
            aria-hidden="true"
          >
            {member.initial}
          </span>
          <span className="access-member-copy">
            <strong>
              {member.name}
              {member.id === currentMemberId ? " · You" : ""}
            </strong>
            <small>{member.relationshipLabel}</small>
            <span>{member.accessLabel}</span>
          </span>
          {member.canReviewRemoval ||
          (mode === "connected" &&
            (member.canManageRole || member.canManageJournal)) ? (
            <button
              type="button"
              aria-label={
                mode === "connected"
                  ? member.profileKind === "managed"
                    ? `Manage journal for ${member.name}`
                    : `Manage role and access for ${member.name}`
                  : `Review access for ${member.name}`
              }
              disabled={disabled}
              aria-expanded={reviewId === member.id}
              aria-controls="access-review"
              onClick={(event) => {
                triggerRef.current = event.currentTarget;
                setInvitationReviewId?.(null);
                setReviewId(reviewId === member.id ? null : member.id);
              }}
            >
              {mode === "connected"
                ? member.profileKind === "managed"
                  ? "Manage journal"
                  : "Manage"
                : "Review access"}
            </button>
          ) : null}
        </li>
      ))}
      {pendingInvitations.map((item) => {
        const canReview = !item.emailRequestId.startsWith("optimistic:");
        return (
          <li key={item.emailRequestId}>
            <span className="person-avatar dot-slate" aria-hidden="true">
              {pendingInitial(item.displayName)}
            </span>
            <span className="access-member-copy">
              <strong>{item.displayName}</strong>
              <small>Pending invite</small>
              <span>Pending</span>
            </span>
            {canReview && setInvitationReviewId && invitationTriggerRef ? (
              <button
                type="button"
                aria-label={`Review invite for ${item.displayName}`}
                disabled={disabled}
                aria-expanded={invitationReviewId === item.emailRequestId}
                aria-controls="invitation-review"
                onClick={(event) => {
                  invitationTriggerRef.current = event.currentTarget;
                  setReviewId(null);
                  setInvitationReviewId(
                    invitationReviewId === item.emailRequestId
                      ? null
                      : item.emailRequestId,
                  );
                }}
              >
                Review invite
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
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
    (defaultCircleId && groups.some((group) => group.id === defaultCircleId)
      ? defaultCircleId
      : groups[0]?.id) ?? "";
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sourceCircleId, setSourceCircleId] = useState(initialSourceId);
  const [whoElse, setWhoElse] = useState<
    readonly Readonly<{ displayName: string; email: string }>[]
  >([]);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [whoElseError, setWhoElseError] = useState("");
  const sourceCircle =
    groups.find((group) => group.id === sourceCircleId) ?? groups[0] ?? null;
  const includedMembers = (sourceCircle?.members ?? []).filter(
    (member) => member.role !== "operations",
  );
  const suggestedName = suggestWiderCircleName(
    sourceCircle?.name ?? "",
    whoElse.map((person) => person.displayName),
  );
  const [name, setName] = useState(suggestedName);
  if (!createGroupAction) return null;

  function addWhoElse() {
    const person = normalizeWiderCirclePerson({
      displayName: draftName,
      email: draftEmail,
    });
    if (!person) {
      setWhoElseError("Enter a name and a complete email address.");
      return;
    }
    if (
      whoElse.some((existing) => existing.email === person.email) ||
      includedMembers.some(
        (member) =>
          member.name.trim().toLowerCase() === person.displayName.toLowerCase(),
      )
    ) {
      setWhoElseError("That person is already included.");
      return;
    }
    const next = [...whoElse, person];
    setWhoElse(next);
    setDraftName("");
    setDraftEmail("");
    setWhoElseError("");
    setName((current) =>
      current.trim() === "" ||
      isWiderCircleNameSuggestion(
        current,
        sourceCircle?.name ?? "",
        whoElse.map((item) => item.displayName),
      )
        ? suggestWiderCircleName(
            sourceCircle?.name ?? "",
            next.map((item) => item.displayName),
          )
        : current,
    );
  }

  return (
    <section
      className="settings-section groups-section groups-create-section"
      aria-labelledby="create-group-heading"
    >
      <div className="settings-heading">
        <span>Wider ring</span>
        <h2 id="create-group-heading">Make a wider circle</h2>
        <p>Everyone in the circle you start from, plus people you add.</p>
      </div>
      <form
        className="wider-circle-form"
        action={(formData) => {
          const pendingPerson = normalizeWiderCirclePerson({
            displayName: draftName,
            email: draftEmail,
          });
          if (pendingPerson) {
            formData.append("whoElseName", pendingPerson.displayName);
            formData.append("whoElseEmail", pendingPerson.email);
          }
          startTransition(async () => {
            const result = await createGroupAction(formData);
            if (result && !result.ok) setError(result.message);
          });
        }}
      >
        <input type="hidden" name="sourceCircleId" value={sourceCircleId} />
        {whoElse.map((person) => (
          <span key={person.email}>
            <input
              type="hidden"
              name="whoElseName"
              value={person.displayName}
            />
            <input type="hidden" name="whoElseEmail" value={person.email} />
          </span>
        ))}

        <fieldset className="wider-circle-step">
          <legend>Start from</legend>
          <label htmlFor="wider-circle-source">Existing circle</label>
          <select
            id="wider-circle-source"
            value={sourceCircleId}
            required
            onChange={(event) => {
              const nextId = event.target.value;
              const nextCircle = groups.find((group) => group.id === nextId);
              setSourceCircleId(nextId);
              setName((current) =>
                current.trim() === "" || current.trim() === suggestedName
                  ? suggestWiderCircleName(
                      nextCircle?.name ?? "",
                      whoElse.map((person) => person.displayName),
                    )
                  : current,
              );
            }}
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <p>
            {includedMembers.length === 1
              ? "You are already in this circle."
              : `Everyone in ${sourceCircle?.name ?? "this circle"} is included.`}
          </p>
          {includedMembers.length > 0 ? (
            <ul className="wider-circle-included">
              {includedMembers.map((member) => (
                <li key={member.id}>{member.name}</li>
              ))}
            </ul>
          ) : null}
        </fieldset>

        <fieldset className="wider-circle-step">
          <legend>Who else?</legend>
          {whoElse.length > 0 ? (
            <ul className="wider-circle-added">
              {whoElse.map((person) => (
                <li key={person.email}>
                  <span>
                    <strong>{person.displayName}</strong>
                    <small>{person.email}</small>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${person.displayName}`}
                    onClick={() => {
                      const next = whoElse.filter(
                        (item) => item.email !== person.email,
                      );
                      setWhoElse(next);
                      setName((current) =>
                        current.trim() === suggestedName
                          ? suggestWiderCircleName(
                              sourceCircle?.name ?? "",
                              next.map((item) => item.displayName),
                            )
                          : current,
                      );
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label htmlFor="wider-circle-who-else-name">Person’s name</label>
          <input
            id="wider-circle-who-else-name"
            value={draftName}
            autoComplete="off"
            maxLength={80}
            onChange={(event) => {
              setDraftName(event.target.value);
              if (whoElseError) setWhoElseError("");
            }}
          />
          <label htmlFor="wider-circle-who-else-email">Email address</label>
          <input
            id="wider-circle-who-else-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            value={draftEmail}
            onChange={(event) => {
              setDraftEmail(event.target.value);
              if (whoElseError) setWhoElseError("");
            }}
          />
          {whoElseError ? (
            <p className="field-error" role="alert">
              {whoElseError}
            </p>
          ) : (
            <p>Optional. They’ll be invited into the new circle.</p>
          )}
          <button type="button" onClick={addWhoElse}>
            Add person
          </button>
        </fieldset>

        <label htmlFor="create-group-name">Name the ring</label>
        <input
          id="create-group-name"
          name="name"
          required
          maxLength={80}
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : (
          <p>Suggested from the circle you start from and who you add.</p>
        )}
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Make this circle"}
        </button>
      </form>
    </section>
  );
}

function CirclesAccordion({
  groups,
  openCircleId,
  onToggle,
  renderOpenCircle,
}: {
  groups: readonly FamilyCircleViewModel[];
  openCircleId: string | null;
  onToggle: (circleId: string) => void;
  renderOpenCircle: (circle: FamilyCircleViewModel) => ReactNode;
}) {
  return (
    <section
      className="settings-section groups-section"
      aria-labelledby="your-groups-heading"
    >
      <div className="settings-heading">
        <span>Membership</span>
        <h2 id="your-groups-heading">Your circles</h2>
      </div>
      <ul className="circle-accordion">
        {groups.map((group) => {
          const open = openCircleId === group.id;
          const panelId = `circle-panel-${group.id}`;
          return (
            <li
              key={group.id}
              className={`circle-accordion-item${open ? " is-open" : ""}`}
            >
              <button
                type="button"
                className="circle-accordion-trigger"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => onToggle(group.id)}
              >
                <span className="access-member-copy">
                  <strong>{group.name}</strong>
                  <small>{peopleCountLabel(group.memberCount)}</small>
                </span>
                <span className="circle-accordion-chevron" aria-hidden="true">
                  <svg viewBox="0 0 16 16">
                    <path d="m4.5 6 3.5 3.5L11.5 6" />
                  </svg>
                </span>
              </button>
              {open ? (
                <div className="circle-accordion-panel" id={panelId}>
                  {renderOpenCircle(group)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PreviewFamilySettingsPanel({
  model,
  createGroupAction,
  inviteCircleId,
  defaultCircleId,
  skipFirstMembers,
  children,
}: {
  model: PreviewFamilySettingsPanelViewModel;
  createGroupAction?: (input: FormData) => Promise<CreateGroupActionResult>;
  inviteCircleId?: string;
  defaultCircleId?: string;
  skipFirstMembers?: boolean;
  children?: ReactNode;
}) {
  const [openCircleId, setOpenCircleId] = useState<string | null>(
    inviteCircleId ?? null,
  );
  const [email, setEmail] = useState("");
  const [reviewEmail, setReviewEmail] = useState<string | null>(null);
  const [emailError, setEmailError] = useState("");
  const [accessReviewId, setAccessReviewId] = useState<string | null>(null);
  const [inviteComposerOpen, setInviteComposerOpen] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const restoreInviteFocusRef = useRef(false);
  const accessTriggerRef = useRef<HTMLButtonElement>(null);
  const accessHeadingRef = useRef<HTMLHeadingElement>(null);
  const inviteReviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const firstMembersCtaRef = useRef<HTMLButtonElement>(null);
  const openCircle =
    model.groups.find((group) => group.id === openCircleId) ?? null;
  const accessReviewMember = openCircle?.members.find(
    (member) => member.id === accessReviewId,
  );
  const promptFirstMembers = shouldPromptFirstMembers(
    openCircle,
    inviteCircleId,
    skipFirstMembers,
  );
  const showInviteComposer = !promptFirstMembers || inviteComposerOpen;

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
    if (promptFirstMembers && !inviteComposerOpen) {
      firstMembersCtaRef.current?.focus();
    }
  }, [promptFirstMembers, inviteComposerOpen]);

  useEffect(() => {
    if (inviteComposerOpen && promptFirstMembers) {
      emailRef.current?.focus();
    }
  }, [inviteComposerOpen, promptFirstMembers]);

  function toggleCircle(circleId: string) {
    setOpenCircleId((current) => (current === circleId ? null : circleId));
    setAccessReviewId(null);
    setReviewEmail(null);
    setEmailError("");
    setInviteComposerOpen(false);
  }

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
    <section className="family-settings-panel">
      <p className="settings-preview-banner">
        Local design preview · Access labels are illustrative; no accounts or
        permissions are active
      </p>

      <CirclesAccordion
        groups={model.groups}
        openCircleId={openCircleId}
        onToggle={toggleCircle}
        renderOpenCircle={(circle) => (
          <>
            <div className="settings-heading circle-access-heading">
              <span>Private circle</span>
              <h3 id="access-heading">People and access</h3>
            </div>
            <MemberList
              members={circle.members}
              currentMemberId={circle.currentMemberId}
              mode="preview"
              reviewId={accessReviewId}
              setReviewId={setAccessReviewId}
              triggerRef={accessTriggerRef}
            />
            {accessReviewMember ? (
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
            ) : null}
            <section
              className="invite-section circle-invite-section"
              id="invite"
              aria-labelledby="invite-heading"
            >
              {!showInviteComposer ? (
                <FirstMembersInvitePrompt
                  circleName={circle.name}
                  onAdd={() => setInviteComposerOpen(true)}
                  ctaRef={firstMembersCtaRef}
                />
              ) : (
                <>
                  <div className="settings-heading">
                    <span>Invitation only</span>
                    <h3 id="invite-heading">Invite into {circle.name}</h3>
                    <p>
                      New relatives will join only after accepting a secure
                      invitation sent to their email address.
                    </p>
                  </div>
                  {reviewEmail ? (
                    <div className="invite-review">
                      <span>Invitation preview</span>
                      <h3 ref={inviteReviewHeadingRef} tabIndex={-1}>
                        {reviewEmail}
                      </h3>
                      <InvitationConsequences />
                      <p className="preview-honesty">
                        Local design preview · Our Days did not send email or
                        create an invite
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
                          emailError
                            ? "family-invite-error"
                            : "family-invite-help"
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
                        Local design preview · Our Days does not send or save
                        this preview
                      </small>
                    </form>
                  )}
                </>
              )}
            </section>
          </>
        )}
      />

      <CreateGroupCard
        createGroupAction={createGroupAction}
        groups={model.groups}
        defaultCircleId={defaultCircleId}
      />
      {children}
    </section>
  );
}

function ConnectedFamilySettingsPanel({
  model,
  actions,
  createGroupAction,
  inviteCircleId,
  defaultCircleId,
  skipFirstMembers,
  children,
}: {
  model: ConnectedFamilySettingsPanelViewModel;
  actions: ConnectedActions;
  createGroupAction?: (input: FormData) => Promise<CreateGroupActionResult>;
  inviteCircleId?: string;
  defaultCircleId?: string;
  skipFirstMembers?: boolean;
  children?: ReactNode;
}) {
  const [openCircleId, setOpenCircleId] = useState<string | null>(
    inviteCircleId ?? null,
  );
  const [accessReviewId, setAccessReviewId] = useState<string | null>(null);
  const [invitationReviewId, setInvitationReviewId] = useState<string | null>(
    null,
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
  const [inviteComposerOpen, setInviteComposerOpen] = useState(false);
  const openCircle =
    model.groups.find((group) => group.id === openCircleId) ?? null;
  const accessReviewMember = openCircle?.members.find(
    (member) => member.id === accessReviewId,
  );
  const listedNames = new Set(
    (openCircle?.pendingInvitations ?? []).map((item) =>
      item.displayName.trim().toLowerCase(),
    ),
  );
  const pendingInvitations = [
    ...(openCircle?.pendingInvitations ?? []),
    ...optimisticPending.filter(
      (item) => !listedNames.has(item.displayName.trim().toLowerCase()),
    ),
  ];
  const invitation = pendingInvitations.find(
    (item) => item.emailRequestId === invitationReviewId,
  );
  const journalCareSuccess =
    result?.ok && accessReviewMember?.profileKind === "managed";
  const promptFirstMembers = shouldPromptFirstMembers(
    openCircle,
    inviteCircleId,
    skipFirstMembers,
  );
  const showInviteComposer = !promptFirstMembers || inviteComposerOpen;

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
    if (promptFirstMembers && !inviteComposerOpen) {
      firstMembersCtaRef.current?.focus();
    }
  }, [promptFirstMembers, inviteComposerOpen]);

  useEffect(() => {
    if (inviteComposerOpen && promptFirstMembers) {
      inviteNameRef.current?.focus();
    }
  }, [inviteComposerOpen, promptFirstMembers]);

  function toggleCircle(circleId: string) {
    setOpenCircleId((current) => (current === circleId ? null : circleId));
    setAccessReviewId(null);
    setInvitationReviewId(null);
    setInviteDraft(null);
    setInviteFormError("");
    setInviteFormErrorField(null);
    setOptimisticPending([]);
    setResult(null);
    setInviteComposerOpen(false);
  }

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
      setInviteFormError("Enter the family member’s name.");
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
    if (!inviteDraft || !actions.requestInvitation || !openCircle) return;
    const requestInvitation = actions.requestInvitation;
    const draft = inviteDraft;
    const requestKey =
      inviteRequestKeyRef.current ?? window.crypto.randomUUID();
    inviteRequestKeyRef.current = requestKey;
    const alreadyListed = (openCircle.pendingInvitations ?? []).some(
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
          circleId: openCircle.id,
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
    if (!membershipId || !openCircle) return;
    setResult(null);
    startTransition(async () => {
      try {
        const nextResult = await actions.revokeMembership({
          membershipId,
          circleId: openCircle.id,
        });
        setResult(
          nextResult.ok
            ? {
                ok: true,
                message: `${accessReviewMember.name} can no longer open this family.`,
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
    if (!membershipId || !openCircle) return;
    setResult(null);
    startTransition(async () => {
      try {
        const nextResult = await actions.setMembershipRole({
          membershipId,
          role,
          circleId: openCircle.id,
        });
        setResult(
          nextResult.ok
            ? {
                ok: true,
                message:
                  role === "organizer"
                    ? `${accessReviewMember.name} is now an organizer.`
                    : `${accessReviewMember.name} is now a family member.`,
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
      !openCircle
    ) {
      return;
    }
    setResult(null);
    startTransition(async () => {
      try {
        const guardianName = openCircle.guardianOptions.find(
          (guardian) => guardian.membershipId === guardianMembershipId,
        )?.name;
        const nextResult = await actions.setGuardian({
          managedPersonId,
          guardianMembershipId,
          grantAccess,
          circleId: openCircle.id,
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
    if (!invitation || !openCircle) return;
    const emailRequestId = invitation.emailRequestId;
    setResult(null);
    startTransition(async () => {
      try {
        const nextResult = await actions.withdrawInvitation({
          emailRequestId,
          circleId: openCircle.id,
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

  return (
    <section className="family-settings-panel">
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

      <CirclesAccordion
        groups={model.groups}
        openCircleId={openCircleId}
        onToggle={toggleCircle}
        renderOpenCircle={(circle) => (
          <>
            <div className="settings-heading circle-access-heading">
              <span>Private circle</span>
              <h3 id="access-heading">People and access</h3>
            </div>
            <MemberList
              members={circle.members}
              currentMemberId={circle.currentMemberId}
              mode="connected"
              reviewId={accessReviewId}
              setReviewId={(id) => {
                setResult(null);
                setInvitationReviewId(null);
                setAccessReviewId(id);
              }}
              triggerRef={accessTriggerRef}
              disabled={isPending}
              pendingInvitations={
                circle.id === openCircle?.id ? pendingInvitations : []
              }
              invitationReviewId={invitationReviewId}
              setInvitationReviewId={(id) => {
                setResult(null);
                setInviteDraft(null);
                setInvitationReviewId(id);
              }}
              invitationTriggerRef={invitationTriggerRef}
            />
            {accessReviewMember ? (
              <aside
                id="access-review"
                className="access-review"
                aria-labelledby="access-review-heading"
              >
                <span>
                  {accessReviewMember.profileKind === "managed"
                    ? "Child journal care"
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
                    guardianOptions={circle.guardianOptions}
                    disabled={isPending}
                    onChange={changeGuardian}
                  />
                ) : (
                  <AccountRoleReview
                    member={accessReviewMember}
                    managedProfiles={circle.members.filter(
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
                      This change is immediate and will also end any guardian
                      authority tied to this account.
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
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={closeAccessReview}
                  >
                    Done
                  </button>
                </div>
              </aside>
            ) : null}
            {invitation ? (
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
                  Withdrawing it prevents this invitation from being accepted.
                  It does not change access for anyone already in the circle.
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
            ) : null}
            <section
              className="invite-section circle-invite-section"
              id="invite"
              aria-labelledby="invite-heading"
            >
              {!showInviteComposer ? (
                <FirstMembersInvitePrompt
                  circleName={circle.name}
                  onAdd={() => setInviteComposerOpen(true)}
                  ctaRef={firstMembersCtaRef}
                />
              ) : (
                <>
                  <div className="settings-heading">
                    <span>Invitation only</span>
                    <h3 id="invite-heading">Invite into {circle.name}</h3>
                    <p>
                      Only organizers can manage invitations. Addresses are used
                      for private delivery and are not shown again after a
                      request is sent.
                    </p>
                  </div>
                  {circle.canManageAccess ? (
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
                            <p className="invite-review-email">
                              {inviteDraft.email}
                            </p>
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
                                {isPending
                                  ? "Sending…"
                                  : "Send private invitation"}
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
                              Family member’s name
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
                                inviteFormErrorField === "name"
                                  ? true
                                  : undefined
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
                                inviteFormErrorField === "email"
                                  ? true
                                  : undefined
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
                                You can review both details before anything is
                                sent.
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
                          <strong>New invitations are not connected yet</strong>
                          <p>
                            Our Days will enable sending after its private email
                            worker can provision the account and deliver a
                            short-lived link safely. No invitation is created
                            from this screen today.
                          </p>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="settings-empty-copy">
                      An organizer can withdraw pending invitations. Sending new
                      invitations will appear after private delivery is
                      connected.
                    </p>
                  )}
                </>
              )}
            </section>
          </>
        )}
      />

      <CreateGroupCard
        createGroupAction={createGroupAction}
        groups={model.groups}
        defaultCircleId={defaultCircleId}
      />
      {children}
    </section>
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
          Operations has full organizer access — invites, membership, journal
          care, and Insights. They are not a family journal person and do not
          appear in Family.
        </p>
      </div>
    );
  }
  const nextRole = member.role === "organizer" ? "member" : "organizer";

  return (
    <div className="settings-role-card">
      <strong>
        Current role:{" "}
        {member.role === "organizer" ? "Organizer" : "Family member"}
      </strong>
      {nextRole === "organizer" ? (
        <p>
          Organizers can invite and remove people, change roles and journal
          care, and care for every child journal. They will manage family
          exports once private archive delivery is connected. This does not let
          them edit another adult’s moments.
        </p>
      ) : (
        <p>
          As a family member, {member.name} will keep sign-in access but lose
          organizer controls and automatic care access for every child journal.
          {assignedJournals.length
            ? ` Explicit care for ${assignedJournals.map((profile) => profile.name).join(", ")} will remain.`
            : " They do not have an explicit assignment, so they will lose care access to every child journal."}
        </p>
      )}
      <button
        type="button"
        aria-label={
          nextRole === "organizer"
            ? `Make organizer: ${member.name}`
            : `Change to family member: ${member.name}`
        }
        aria-busy={disabled || undefined}
        disabled={disabled}
        onClick={() => onChangeRole(nextRole)}
      >
        {nextRole === "organizer"
          ? "Make organizer"
          : "Change to family member"}
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
        Organizers can care for every child journal. An assigned guardian keeps
        care access as a family member, even without organizer controls.
      </p>
      <fieldset className="guardian-options">
        <legend>Assigned guardians</legend>
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
                        ? "Family member · assigned guardian"
                        : "Family member · no care access"}
                  </small>
                </span>
                <button
                  type="button"
                  aria-label={`${assigned ? "Remove" : "Assign"} ${guardian.name} as guardian for ${member.name}`}
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
        Removing access would end sign-in to this family circle. Their authored
        moments would remain part of the family history. Access removal does not
        delete their account or content; any later deletion follows a separate
        ownership policy.
      </p>
    );
  }
  return (
    <p>
      Removing access ends sign-in to this family circle. Their authored moments
      remain part of the family history. Access removal does not delete their
      account or content; any later deletion follows a separate ownership
      policy.
    </p>
  );
}

function InvitationConsequences() {
  return (
    <p>
      This person would be able to open the circle and see its family moments,
      photos, notes, people, and saved places. Organizer access would always
      require a separate, deliberate change.
    </p>
  );
}
