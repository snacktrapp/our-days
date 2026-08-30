"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { FamilySettingsPanelViewModel } from "./family-settings-view-model";

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function FamilySettingsPanel({
  model,
}: {
  model: FamilySettingsPanelViewModel;
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
        <div className="settings-heading">
          <span>Private circle</span>
          <h2 id="access-heading">Who can open Our Days</h2>
          <p>
            Accounts can sign in. Managed profiles hold a child’s journal but
            cannot open the app themselves.
          </p>
        </div>
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
              {member.canPreviewRemoval ? (
                <button
                  type="button"
                  aria-expanded={accessReviewId === member.id}
                  aria-controls="access-review"
                  onClick={(event) => {
                    accessTriggerRef.current = event.currentTarget;
                    setAccessReviewId((current) =>
                      current === member.id ? null : member.id,
                    );
                  }}
                >
                  Review access
                </button>
              ) : null}
            </li>
          ))}
        </ul>
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
            <p>
              Removing access would end sign-in to this family circle. Their
              authored moments would remain part of the family history. Access
              removal does not delete their account or content; any later
              deletion follows a separate ownership policy.
            </p>
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
            <p>
              This person would be able to open the circle and see its family
              moments, photos, notes, people, and saved places. Organizer access
              would always require a separate, deliberate change.
            </p>
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
