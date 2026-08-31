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
  const [codeRevision, setCodeRevision] = useState(0);
  const [cleanupState, setCleanupState] = useState<
    "checking" | "failed" | "ready"
  >("checking");
  const [intentState, setIntentState] = useState<IntentState>(
    hasStagedIntent ? "ready" : "opening",
  );
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
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
          window.setTimeout(
            () =>
              window.location.replace(
                `${window.location.pathname}${window.location.search}`,
              ),
            50,
          );
          return;
        }
        clearFragment();
        setIntentState("incomplete");
      });
  }, [hasStagedIntent]);

  useEffect(() => {
    if (intentState !== "ready" || cleanupState !== "checking") return;
    let active = true;
    void purgeOurDaysBrowserState().then((cleared) => {
      if (!active) return;
      setCleanupState(cleared ? "ready" : "failed");
    });
    return () => {
      active = false;
    };
  }, [cleanupState, intentState]);

  useEffect(() => {
    if (intentState !== "ready" || cleanupState !== "ready") return;
    emailInput.current?.focus({ preventScroll: true });
  }, [cleanupState, intentState]);

  useEffect(() => {
    if (verifyState.status === "accepted") {
      const timeout = window.setTimeout(
        () => window.location.replace("/family"),
        50,
      );
      return () => window.clearTimeout(timeout);
    }
  }, [verifyState.status]);

  const verifyIsError =
    verifyState.revision === codeRevision &&
    ["invalid", "denied", "unavailable"].includes(verifyState.status);
  const busy = verifyPending || verifyState.status === "accepted";

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
          ) : cleanupState !== "ready" ? (
            <>
              <p
                className={cleanupState === "failed" ? "auth-error" : undefined}
                role={cleanupState === "failed" ? "alert" : "status"}
              >
                {cleanupState === "failed"
                  ? "Private browser data is still open in another Our Days tab. Close it, then reload this invitation before continuing."
                  : "Preparing a private invitation…"}
              </p>
              {cleanupState === "failed" ? (
                <Link href="/sign-in">Sign in as a returning member</Link>
              ) : null}
            </>
          ) : (
            <>
              <p>
                Your organizer sent two private emails. Use the address they
                invited and the newest six-digit code from the Our Days
                invitation or sign-in message.
              </p>
              <form action={verifyAction} noValidate>
                <input type="hidden" name="revision" value={codeRevision} />
                <label htmlFor="invite-email">Email address</label>
                <input
                  ref={emailInput}
                  id="invite-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  disabled={busy}
                  value={email}
                  aria-invalid={verifyIsError ? true : undefined}
                  aria-describedby={
                    verifyState.revision === codeRevision && verifyState.message
                      ? "invite-verify-status"
                      : undefined
                  }
                  onChange={(event) => setEmail(event.target.value)}
                />
                <label htmlFor="invite-code">Six-digit invitation code</label>
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
                  disabled={busy}
                  aria-invalid={verifyIsError ? true : undefined}
                  aria-describedby={
                    verifyState.revision === codeRevision && verifyState.message
                      ? "invite-verify-status"
                      : undefined
                  }
                  onChange={() => setCodeRevision((revision) => revision + 1)}
                />
                <button type="submit" disabled={busy}>
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
              <p>
                Missing or expired code? Ask your organizer for a fresh private
                invitation.
              </p>
              <Link href="/sign-in">Sign in as a returning member</Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
