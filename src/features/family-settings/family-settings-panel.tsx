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
  FamilySettingsPanelViewModel,
  PreviewFamilySettingsPanelViewModel,
} from "./family-settings-view-model";

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

type ConnectedActions = Readonly<{
  revokeMembership: (input: {
    membershipId: string;
  }) => Promise<FamilySettingsActionResult>;
  revokeInvitation: (input: {
    invitationId: string;
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
          {member.canReviewRemoval ? (
            <button
              type="button"
              aria-label={`Review access for ${member.name}`}
              disabled={disabled}
              aria-expanded={reviewId === member.id}
              aria-controls="access-review"
              onClick={(event) => {
                triggerRef.current = event.currentTarget;
                setReviewId(reviewId === member.id ? null : member.id);
              }}
            >
              Review access
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
  const [result, setResult] = useState<FamilySettingsActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const accessTriggerRef = useRef<HTMLButtonElement>(null);
  const invitationTriggerRef = useRef<HTMLButtonElement>(null);
  const accessHeadingRef = useRef<HTMLHeadingElement>(null);
  const invitationHeadingRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const accessReviewMember = model.members.find(
    (member) => member.id === accessReviewId,
  );
  const invitation = model.pendingInvitations.find(
    (item) => item.id === invitationReviewId,
  );

  useEffect(() => {
    if (accessReviewId) accessHeadingRef.current?.focus();
  }, [accessReviewId]);

  useEffect(() => {
    if (invitationReviewId) invitationHeadingRef.current?.focus();
  }, [invitationReviewId]);

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

  function removeAccess() {
    const membershipId = accessReviewMember?.membershipId;
    if (!membershipId) return;
    setResult(null);
    startTransition(async () => {
      try {
        const nextResult = await actions.revokeMembership({ membershipId });
        setResult(nextResult);
        if (nextResult.ok) setAccessReviewId(null);
      } catch {
        setResult({
          ok: false,
          message: "That access could not be removed. Try again.",
        });
      }
    });
  }

  function withdrawInvitation() {
    if (!invitation) return;
    const invitationId = invitation.id;
    setResult(null);
    startTransition(async () => {
      try {
        const nextResult = await actions.revokeInvitation({ invitationId });
        setResult(nextResult);
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
      {result?.ok ? (
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
            <span>Remove access</span>
            <h3 ref={accessHeadingRef} id="access-review-heading" tabIndex={-1}>
              Review {accessReviewMember.name}’s access
            </h3>
            <RemovalConsequences />
            <p className="settings-confirmation-copy">
              This change is immediate and will also end any guardian authority
              tied to this account.
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
                onClick={closeAccessReview}
              >
                Keep access
              </button>
              <button
                type="button"
                aria-label={`Remove ${accessReviewMember.name}’s access`}
                className="settings-danger-button"
                disabled={isPending}
                onClick={removeAccess}
              >
                {isPending ? "Removing…" : "Remove access"}
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
            Only organizers can manage invitations. Invitation addresses and
            secret links are never shown here.
          </p>
        </div>
        {model.canManageAccess ? (
          <>
            {model.pendingInvitations.length ? (
              <ul className="pending-invitation-list">
                {model.pendingInvitations.map((item) => (
                  <li key={item.id}>
                    <span>
                      <strong>{item.displayName}</strong>
                      <small>
                        {item.createdLabel} · {item.expiresLabel}
                      </small>
                    </span>
                    <button
                      type="button"
                      aria-label={`Review invitation for ${item.displayName}`}
                      disabled={isPending}
                      aria-expanded={invitationReviewId === item.id}
                      aria-controls="invitation-review"
                      onClick={(event) => {
                        invitationTriggerRef.current = event.currentTarget;
                        setResult(null);
                        setAccessReviewId(null);
                        setInvitationReviewId((current) =>
                          current === item.id ? null : item.id,
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
                    aria-label={`Withdraw ${invitation.displayName}’s invitation`}
                    className="settings-danger-button"
                    disabled={isPending}
                    onClick={withdrawInvitation}
                  >
                    {isPending ? "Withdrawing…" : "Withdraw invitation"}
                  </button>
                </div>
              </aside>
            ) : null}
            <div className="settings-delivery-boundary">
              <strong>New invitations are not connected yet</strong>
              <p>
                Our Days will enable sending after its private email worker can
                provision the account and deliver a short-lived link safely. No
                invitation is created from this screen today.
              </p>
            </div>
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

function SettingsAccessHeading() {
  return (
    <div className="settings-heading">
      <span>Private circle</span>
      <h2 id="access-heading">Who can open Our Days</h2>
      <p>
        Accounts can sign in. Managed profiles hold a child’s journal but cannot
        open the app themselves.
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
