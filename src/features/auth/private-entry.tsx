"use client";

import { useActionState, useEffect, useState } from "react";
import { purgeOurDaysBrowserState } from "@/lib/auth/browser-private-state";
import { requestSignInLink, type SignInActionState } from "./sign-in-actions";

const initialSignInActionState: SignInActionState = { status: "idle" };

const oauthIssueCopy = {
  unavailable: "That sign-in method is unavailable right now.",
  invalid:
    "That sign-in did not finish. Try Google, X, or email a private link.",
  "no-access": "This account does not have access to a family circle.",
  "no-email":
    "That account did not share an email we can match to a family invitation.",
} as const;

export function PrivateEntry({
  connected = false,
  cleanupIncomplete = false,
  linkIssue,
  oauthIssue,
}: {
  connected?: boolean;
  cleanupIncomplete?: boolean;
  linkIssue?: "invalid" | "unavailable";
  oauthIssue?: keyof typeof oauthIssueCopy;
}) {
  const [email, setEmail] = useState("");
  const [emailEdited, setEmailEdited] = useState(false);
  const [cleanupState, setCleanupState] = useState<
    "checking" | "failed" | "ready"
  >(cleanupIncomplete ? "checking" : "ready");
  const [requestState, requestAction, requestPending] = useActionState(
    requestSignInLink,
    initialSignInActionState,
  );
  const linkRequested = requestState.status === "sent";

  useEffect(() => {
    if (!cleanupIncomplete) return;
    void purgeOurDaysBrowserState().then((cleared) => {
      if (cleared) {
        window.history.replaceState(window.history.state, "", "/sign-in");
        setCleanupState("ready");
      } else {
        setCleanupState("failed");
      }
    });
  }, [cleanupIncomplete]);

  const requestIsError =
    !emailEdited &&
    ["invalid", "denied", "unavailable"].includes(requestState.status);
  const submittedEmail = requestState.email ?? email.trim().toLowerCase();
  const busy = requestPending;

  return (
    <main className="private-entry-shell">
      <section
        className="private-entry-card"
        aria-labelledby="private-entry-title"
      >
        <span className="private-entry-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="eyebrow">Our Days</span>
        <h1 id="private-entry-title">
          {connected
            ? "Open your family journal."
            : "Our Days is invitation only."}
        </h1>
        {cleanupState !== "ready" ? (
          <div className="private-entry-content">
            <p
              className={cleanupState === "failed" ? "auth-error" : undefined}
              role={cleanupState === "failed" ? "alert" : "status"}
            >
              {cleanupState === "failed"
                ? "Private browser data is still open in another Our Days tab. Close it, then reload this page before signing in."
                : "Finishing private browser cleanup…"}
            </p>
          </div>
        ) : connected ? (
          <div className="private-entry-content">
            <p>Use the Google or X account your family invited.</p>
            {oauthIssue ? (
              <p className="auth-error" role="alert">
                {oauthIssueCopy[oauthIssue]}
              </p>
            ) : null}
            <div className="private-entry-oauth">
              <form action="/api/auth/oauth/google" method="get">
                <button type="submit">Sign in with Google</button>
              </form>
              <form action="/api/auth/oauth/x" method="get">
                <button type="submit">Sign in with X</button>
              </form>
            </div>
            {linkRequested ? (
              <div className="private-entry-backup">
                <p>
                  We sent a private sign-in link to{" "}
                  <strong>{submittedEmail}</strong>.
                </p>
                <p>Open that email on this device and tap the link.</p>
                <a href="/sign-in">Use a different email</a>
              </div>
            ) : (
              <div className="private-entry-backup">
                <p>Or email a private sign-in link</p>
                <p>Enter the email address your family invited.</p>
                {linkIssue ? (
                  <p className="auth-error" role="alert">
                    {linkIssue === "invalid"
                      ? "That sign-in link is invalid or has expired. Request a new one."
                      : "Our Days could not finish signing you in. Please request a new link."}
                  </p>
                ) : null}
                <form
                  action={requestAction}
                  noValidate
                  onSubmit={() => setEmailEdited(false)}
                >
                  <label htmlFor="sign-in-email">Email address</label>
                  <input
                    id="sign-in-email"
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
                        ? "sign-in-request-status"
                        : undefined
                    }
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setEmailEdited(true);
                    }}
                  />
                  <button type="submit" disabled={busy}>
                    {requestPending ? "Sending…" : "Email me a sign-in link"}
                  </button>
                  {!emailEdited && requestState.message ? (
                    <p
                      id="sign-in-request-status"
                      className={requestIsError ? "auth-error" : "auth-status"}
                      role={requestIsError ? "alert" : "status"}
                    >
                      {requestState.message}
                    </p>
                  ) : null}
                </form>
              </div>
            )}
          </div>
        ) : (
          <span>
            Sign-in opens only after the private circle boundary is connected.
          </span>
        )}
      </section>
    </main>
  );
}
