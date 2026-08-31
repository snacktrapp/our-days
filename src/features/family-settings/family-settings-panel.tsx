"use client";

import {
  type FormEvent,
  type MutableRefObject,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import type { FamilySettingsActionResult } from "./family-settings-actions";
import type {
  ConnectedFamilySettingsPanelViewModel,
  FamilyAccessMemberViewModel,
  FamilySettingsPanelViewModel,
  GuardianOptionViewModel,
  PreviewFamilySettingsPanelViewModel,
} from "./family-settings-view-model";

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

type ConnectedActions = Readonly<{
  requestInvitation?: (input: {
    displayName: string;
    email: string;
    requestKey: string;
  }) => Promise<FamilySettingsActionResult>;
  revokeMembership: (input: {
    membershipId: string;
  }) => Promise<FamilySettingsActionResult>;
  withdrawInvitation: (input: {
    emailRequestId: string;
  }) => Promise<FamilySettingsActionResult>;
  setMembershipRole: (input: {
    membershipId: string;
    role: "member" | "organizer";
  }) => Promise<FamilySettingsActionResult>;
  setGuardian: (input: {
    managedPersonId: string;
    guardianMembershipId: string;
    grantAccess: boolean;
  }) => Promise<FamilySettingsActionResult>;
}>;

export function FamilySettingsPanel({
  model,
  actions,
}: {
  model: FamilySettingsPanelViewModel;
  actions?: ConnectedActions;
}) {
  if (model.mode === "preview") {
    return <PreviewFamilySettingsPanel model={model} />;
  }
  if (!actions)
    throw new Error("Connected family settings actions are required");
  if (model.invitationDelivery === "enabled" && !actions.requestInvitation) {
    throw new Error("Connected invitation delivery action is required");
  }
  return <ConnectedFamilySettingsPanel model={model} actions={actions} />;
}

function MemberList({
  model,
  reviewId,
  setReviewId,
  triggerRef,
  disabled = false,
}: {
  model:
    PreviewFamilySettingsPanelViewModel | ConnectedFamilySettingsPanelViewModel;
  reviewId: string | null;
  setReviewId: (id: string | null) => void;
  triggerRef: MutableRefObject<HTMLButtonElement | null>;
  disabled?: boolean;
}) {
  return (
    <ul className="access-list">
      {model.members.map((member) => (
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
              {member.id === model.currentMemberId ? " · You" : ""}
            </strong>
            <small>{member.relationshipLabel}</small>
            <span>{member.accessLabel}</span>
          </span>
          {member.canReviewRemoval ||
          (model.mode === "connected" &&
            (member.canManageRole || member.canManageJournal)) ? (
            <button
              type="button"
              aria-label={
                model.mode === "connected"
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
                setReviewId(reviewId === member.id ? null : member.id);
              }}
            >
              {model.mode === "connected"
                ? member.profileKind === "managed"
                  ? "Manage journal"
                  : "Manage"
                : "Review access"}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function PreviewFamilySettingsPanel({
  model,
}: {
  model: PreviewFamilySettingsPanelViewModel;
}) {
  const [email, setEmail] = useState("");
  const [reviewEmail, setReviewEmail] = useState<string | null>(null);
  const [emailError, setEmailError] = useState("");
  const [accessReviewId, setAccessReviewId] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const restoreInviteFocusRef = useRef(false);
  const accessTriggerRef = useRef<HTMLButtonElement>(null);
  const accessHeadingRef = useRef<HTMLHeadingElement>(null);
  const inviteReviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const accessReviewMember = model.members.find(
    (member) => member.id === accessReviewId,
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
    <section className="section-panel family-settings-panel">
      <p className="section-intro">{model.intro}</p>
      <p className="settings-preview-banner">
        Local design preview · Access labels are illustrative; no accounts or
        permissions are active
      </p>

      <section className="settings-section" aria-labelledby="access-heading">
        <SettingsAccessHeading />
        <MemberList
          model={model}
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
            <h3 ref={accessHeadingRef} id="access-review-heading" tabIndex={-1}>
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
      </section>

      <section
        className="settings-section invite-section"
        id="invite"
        aria-labelledby="invite-heading"
      >
        <div className="settings-heading">
          <span>Invitation only</span>
          <h2 id="invite-heading">Invite a family member</h2>
          <p>
            New relatives will join only after accepting a secure invitation
            sent to their email address.
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
              <p id="family-invite-error" className="field-error" role="alert">
                {emailError}
              </p>
            ) : (
              <p id="family-invite-help">
                You can review the address before anything is sent.
              </p>
            )}
            <button type="submit">Review invitation</button>
            <small>
              Local design preview · Our Days does not send or save this preview
            </small>
          </form>
        )}
      </section>
    </section>
  );
}

function ConnectedFamilySettingsPanel({
  model,
  actions,
}: {
  model: ConnectedFamilySettingsPanelViewModel;
  actions: ConnectedActions;
}) {
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
  const accessReviewMember = model.members.find(
    (member) => member.id === accessReviewId,
  );
  const invitation = model.pendingInvitations.find(
    (item) => item.emailRequestId === invitationReviewId,
  );
  const journalCareSuccess =
    result?.ok && accessReviewMember?.profileKind === "managed";

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

  function editInvitationRequest() {
    restoreInviteFormFocusRef.current = true;
    inviteRequestKeyRef.current = null;
    setResult(null);
    setInviteDraft(null);
  }

  function sendInvitationRequest() {
    if (!inviteDraft || !actions.requestInvitation) return;
    const requestInvitation = actions.requestInvitation;
    const requestKey =
      inviteRequestKeyRef.current ?? window.crypto.randomUUID();
    inviteRequestKeyRef.current = requestKey;
    setResult(null);
    startTransition(async () => {
      try {
        const nextResult = await requestInvitation({
          ...inviteDraft,
          requestKey,
        });
        setResult(
          nextResult.ok
            ? {
                ok: true,
                message: `Private invitation requested for ${inviteDraft.displayName}.`,
              }
            : nextResult,
        );
        if (nextResult.ok) {
          inviteRequestKeyRef.current = null;
          setInviteDraft(null);
          setInviteName("");
          setInviteEmail("");
        }
      } catch {
        setResult({
          ok: false,
          message: "That invitation could not be sent. Try again.",
        });
      }
    });
  }

  function removeAccess() {
    const membershipId = accessReviewMember?.membershipId;
    if (!membershipId) return;
    setResult(null);
    startTransition(async () => {
      try {
        const nextResult = await actions.revokeMembership({ membershipId });
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
    if (!membershipId) return;
    setResult(null);
    startTransition(async () => {
      try {
        const nextResult = await actions.setMembershipRole({
          membershipId,
          role,
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
    if (!managedPersonId || accessReviewMember.profileKind !== "managed") {
      return;
    }
    setResult(null);
    startTransition(async () => {
      try {
        const guardianName = model.guardianOptions.find(
          (guardian) => guardian.membershipId === guardianMembershipId,
        )?.name;
        const nextResult = await actions.setGuardian({
          managedPersonId,
          guardianMembershipId,
          grantAccess,
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
    if (!invitation) return;
    const emailRequestId = invitation.emailRequestId;
    setResult(null);
    startTransition(async () => {
      try {
        const nextResult = await actions.withdrawInvitation({
          emailRequestId,
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
    <section className="section-panel family-settings-panel">
      <p className="section-intro">{model.intro}</p>
      <p className="settings-live-banner">
        Private circle · Access changes take effect at the next request
      </p>
      {result?.ok && !journalCareSuccess ? (
        <p
          ref={resultRef}
          className={`settings-action-message${result.ok ? "" : " settings-action-error"}`}
          role={result.ok ? "status" : "alert"}
          tabIndex={-1}
        >
          {result.message}
        </p>
      ) : null}

      <section className="settings-section" aria-labelledby="access-heading">
        <SettingsAccessHeading />
        <MemberList
          model={model}
          reviewId={accessReviewId}
          setReviewId={(id) => {
            setResult(null);
            setInvitationReviewId(null);
            setAccessReviewId(id);
          }}
          triggerRef={accessTriggerRef}
          disabled={isPending}
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
            <h3 ref={accessHeadingRef} id="access-review-heading" tabIndex={-1}>
              {accessReviewMember.profileKind === "managed"
                ? `Care for ${accessReviewMember.name}’s journal`
                : `Manage ${accessReviewMember.name}`}
            </h3>
            {accessReviewMember.profileKind === "managed" ? (
              <JournalCareReview
                member={accessReviewMember}
                guardianOptions={model.guardianOptions}
                disabled={isPending}
                onChange={changeGuardian}
              />
            ) : (
              <AccountRoleReview
                member={accessReviewMember}
                managedProfiles={model.members.filter(
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
      </section>

      <section
        className="settings-section invite-section"
        id="invite"
        aria-labelledby="invite-heading"
      >
        <div className="settings-heading">
          <span>Invitation only</span>
          <h2 id="invite-heading">Family invitations</h2>
          <p>
            Only organizers can manage invitations. Addresses are used for
            private delivery and are not shown again after a request is sent.
          </p>
        </div>
        {model.canManageAccess ? (
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
            {model.pendingInvitations.length ? (
              <ul className="pending-invitation-list">
                {model.pendingInvitations.map((item) => (
                  <li key={item.emailRequestId}>
                    <span>
                      <strong>{item.displayName}</strong>
                      <em className={`invitation-status status-${item.state}`}>
                        {item.statusLabel}
                      </em>
                      <small>
                        {item.createdLabel} · {item.expiresLabel}
                      </small>
                    </span>
                    <button
                      type="button"
                      aria-label={`Review invite for ${item.displayName}`}
                      disabled={isPending}
                      aria-expanded={invitationReviewId === item.emailRequestId}
                      aria-controls="invitation-review"
                      onClick={(event) => {
                        invitationTriggerRef.current = event.currentTarget;
                        setResult(null);
                        setInviteDraft(null);
                        setAccessReviewId(null);
                        setInvitationReviewId((current) =>
                          current === item.emailRequestId
                            ? null
                            : item.emailRequestId,
                        );
                      }}
                    >
                      Review invite
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="settings-empty-copy">No pending invitations.</p>
            )}
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
            {model.invitationDelivery === "disabled" ? (
              <div className="settings-delivery-boundary">
                <strong>New invitations are not connected yet</strong>
                <p>
                  Our Days will enable sending after its private email worker
                  can provision the account and deliver a short-lived link
                  safely. No invitation is created from this screen today.
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="settings-empty-copy">
            An organizer can withdraw pending invitations. Sending new
            invitations will appear after private delivery is connected.
          </p>
        )}
      </section>
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

function SettingsAccessHeading() {
  return (
    <div className="settings-heading">
      <span>Private circle</span>
      <h2 id="access-heading">People and access</h2>
      <p>
        Accounts can sign in. Child journals have no sign-in and are cared for
        by organizers and assigned guardians.
      </p>
    </div>
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
