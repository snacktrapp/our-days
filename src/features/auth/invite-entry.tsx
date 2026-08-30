"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { purgeOurDaysBrowserState } from "@/lib/auth/browser-private-state";
import {
  requestInviteCode,
  stageInvitationIntent,
  type InviteActionState,
  verifyAndAcceptInvitation,
} from "./invite-actions";

const initialInviteActionState: InviteActionState = { status: "idle" };
const INVITATION_TOKEN = /^[A-Za-z0-9_-]{40,64}$/u;

type IntentState = "opening" | "ready" | "incomplete";

export function InviteEntry({
  hasStagedIntent = false,
}: Readonly<{ hasStagedIntent?: boolean }>) {
  const [email, setEmail] = useState("");
  const [emailEdited, setEmailEdited] = useState(false);
  const [codeRevision, setCodeRevision] = useState(0);
  const [clearedRequestEmail, setClearedRequestEmail] = useState<string | null>(
    null,
  );
  const [browserCleanupFailed, setBrowserCleanupFailed] = useState(false);
  const [intentState, setIntentState] = useState<IntentState>(
    hasStagedIntent ? "ready" : "opening",
  );
  const codeInput = useRef<HTMLInputElement>(null);
  const [requestState, requestAction, requestPending] = useActionState(
    requestInviteCode,
    initialInviteActionState,
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyAndAcceptInvitation,
    initialInviteActionState,
  );

  useLayoutEffect(() => {
    const token = window.location.hash.slice(1);
    if (!token) {
      if (hasStagedIntent) return;
      const frame = window.requestAnimationFrame(() => {
        setIntentState("incomplete");
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const clearFragment = () => {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    };
    clearFragment();
    if (!INVITATION_TOKEN.test(token)) {
      void stageInvitationIntent("")
        .catch(() => ({ ready: false as const }))
        .then(() => {
          clearFragment();
          setIntentState("incomplete");
        });
      return;
    }

    void stageInvitationIntent(token)
      .catch(() => ({ ready: false as const }))
      .then(({ ready }) => {
        if (ready) {
          window.location.replace(
            `${window.location.pathname}${window.location.search}`,
          );
          return;
        }
        clearFragment();
        setIntentState("incomplete");
      });
  }, [hasStagedIntent]);

  const codeRequested = requestState.status === "sent";
  const cleanupRequestEmail = requestState.clearBrowserState
    ? (requestState.email ?? null)
    : null;
  const browserStateReady =
    cleanupRequestEmail === null || clearedRequestEmail === cleanupRequestEmail;
  useEffect(() => {
    if (!cleanupRequestEmail || clearedRequestEmail === cleanupRequestEmail) {
      return;
    }
    void purgeOurDaysBrowserState().then((cleared) => {
      setBrowserCleanupFailed(!cleared);
      if (cleared) setClearedRequestEmail(cleanupRequestEmail);
    });
  }, [cleanupRequestEmail, clearedRequestEmail]);

  useEffect(() => {
    if (!codeRequested || !browserStateReady) return;
    codeInput.current?.focus({ preventScroll: true });
    codeInput.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [browserStateReady, codeRequested]);

  const requestIsError =
    !emailEdited &&
    ["invalid", "denied", "unavailable"].includes(requestState.status);
  const verifyIsError =
    verifyState.revision === codeRevision &&
    ["invalid", "denied", "unavailable"].includes(verifyState.status);
  const submittedEmail = requestState.email ?? email.trim().toLowerCase();
  const busy = requestPending || verifyPending;

  return (
    <main className="private-entry-shell">
      <section
        className="private-entry-card"
        aria-labelledby="invite-entry-title"
      >
        <span className="private-entry-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <p>Private family invitation</p>
        <h1 id="invite-entry-title">Join your family journal.</h1>
        <div className="private-entry-content">
          {intentState === "opening" ? (
            <p role="status">Opening your private invitation…</p>
          ) : intentState === "incomplete" ? (
            <>
              <p role="alert" className="auth-error">
                This invitation link is incomplete. Reopen the link in your
                invitation email or ask your organizer for a new one.
              </p>
              <Link href="/sign-in">Sign in as a returning member</Link>
            </>
          ) : codeRequested ? (
            <>
              <p>
                We sent a six-digit code to <strong>{submittedEmail}</strong>.
                You can safely return here after opening Mail.
              </p>
              {browserCleanupFailed ? (
                <p className="auth-error" role="alert">
                  Private browser data could not be cleared. Close other Our
                  Days tabs, then use a different email and try again.
                </p>
              ) : null}
              <form action={verifyAction} noValidate>
                <input type="hidden" name="email" value={submittedEmail} />
                <input type="hidden" name="revision" value={codeRevision} />
                <label htmlFor="invite-code">Six-digit code</label>
                <input
                  ref={codeInput}
                  id="invite-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  disabled={busy || !browserStateReady}
                  aria-invalid={verifyIsError ? true : undefined}
                  aria-describedby={
                    verifyState.revision === codeRevision && verifyState.message
                      ? "invite-verify-status"
                      : undefined
                  }
                  onChange={() => setCodeRevision((revision) => revision + 1)}
                />
                <button type="submit" disabled={busy || !browserStateReady}>
                  {verifyPending ? "Joining…" : "Join family journal"}
                </button>
                {verifyState.revision === codeRevision &&
                verifyState.message ? (
                  <p
                    id="invite-verify-status"
                    className={verifyIsError ? "auth-error" : "auth-status"}
                    role={verifyIsError ? "alert" : "status"}
                  >
                    {verifyState.message}
                  </p>
                ) : null}
              </form>
              <a href="/invite">Use a different email</a>
            </>
          ) : (
            <>
              <p>
                Use the email address where your invitation arrived. If another
                account is open on this device, continuing will sign it out.
              </p>
              <form
                action={requestAction}
                noValidate
                onSubmit={() => setEmailEdited(false)}
              >
                <label htmlFor="invite-email">Email address</label>
                <input
                  id="invite-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  disabled={busy}
                  value={email}
                  aria-invalid={requestIsError ? true : undefined}
                  aria-describedby={
                    !emailEdited && requestState.message
                      ? "invite-request-status"
                      : undefined
                  }
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setEmailEdited(true);
                  }}
                />
                <button type="submit" disabled={busy}>
                  {requestPending ? "Sending…" : "Email me a code"}
                </button>
                {!emailEdited && requestState.message ? (
                  <p
                    id="invite-request-status"
                    className={requestIsError ? "auth-error" : "auth-status"}
                    role={requestIsError ? "alert" : "status"}
                  >
                    {requestState.message}
                  </p>
                ) : null}
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
