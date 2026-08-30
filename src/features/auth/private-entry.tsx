"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { purgeOurDaysBrowserState } from "@/lib/auth/browser-private-state";
import {
  requestSignInCode,
  type SignInActionState,
  verifySignInCode,
} from "./sign-in-actions";

const initialSignInActionState: SignInActionState = { status: "idle" };

export function PrivateEntry({
  connected = false,
  cleanupIncomplete = false,
}: {
  connected?: boolean;
  cleanupIncomplete?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [emailEdited, setEmailEdited] = useState(false);
  const [codeRevision, setCodeRevision] = useState(0);
  const [submittedCodeRevision, setSubmittedCodeRevision] = useState(-1);
  const codeInput = useRef<HTMLInputElement>(null);
  const [cleanupState, setCleanupState] = useState<
    "checking" | "failed" | "ready"
  >(cleanupIncomplete ? "checking" : "ready");
  const [requestState, requestAction, requestPending] = useActionState(
    requestSignInCode,
    initialSignInActionState,
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifySignInCode,
    initialSignInActionState,
  );
  const codeRequested = requestState.status === "sent";

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

  useEffect(() => {
    if (!codeRequested) return;
    codeInput.current?.focus({ preventScroll: true });
    codeInput.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [codeRequested]);

  const requestIsError =
    !emailEdited &&
    ["invalid", "denied", "unavailable"].includes(requestState.status);
  const verifyIsError =
    submittedCodeRevision === codeRevision &&
    ["invalid", "denied", "no-access", "unavailable"].includes(
      verifyState.status,
    );
  const submittedEmail = requestState.email ?? email.trim().toLowerCase();
  const busy = requestPending || verifyPending;

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
        <p>Private family journal</p>
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
            {codeRequested ? (
              <>
                <p>
                  We sent a six-digit code to <strong>{submittedEmail}</strong>.
                </p>
                <form
                  action={verifyAction}
                  noValidate
                  onSubmit={() => setSubmittedCodeRevision(codeRevision)}
                >
                  <input type="hidden" name="email" value={submittedEmail} />
                  <label htmlFor="sign-in-code">Six-digit code</label>
                  <input
                    ref={codeInput}
                    id="sign-in-code"
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
                      submittedCodeRevision === codeRevision &&
                      verifyState.message
                        ? "sign-in-verify-status"
                        : undefined
                    }
                    onChange={() => setCodeRevision((revision) => revision + 1)}
                  />
                  <button type="submit" disabled={busy}>
                    {verifyPending ? "Opening…" : "Open family journal"}
                  </button>
                  {submittedCodeRevision === codeRevision &&
                  verifyState.message ? (
                    <p
                      id="sign-in-verify-status"
                      className={verifyIsError ? "auth-error" : "auth-status"}
                      role={verifyIsError ? "alert" : "status"}
                    >
                      {verifyState.message}
                    </p>
                  ) : null}
                </form>
                <a href="/sign-in">Use a different email</a>
              </>
            ) : (
              <>
                <p>Enter the email address your family invited.</p>
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
                    {requestPending ? "Sending…" : "Email me a code"}
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
              </>
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
