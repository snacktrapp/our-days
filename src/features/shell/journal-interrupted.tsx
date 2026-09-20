"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useJournalShell } from "./journal-shell-context";
import { usePendingJournalRoute } from "./journal-pending-route";

function InPlaceJournalError({ recover }: { recover?: () => void }) {
  const finish = usePendingJournalRoute()?.finish;
  useEffect(() => {
    finish?.();
  }, [finish]);
  return (
    <section className="timeline-empty-state" role="alert">
      <strong>This journal couldn’t open.</strong>
      <span>Try again, or choose another page.</span>
      {recover ? (
        <button type="button" className="retry-button" onClick={recover}>
          Try again
        </button>
      ) : null}
    </section>
  );
}

export function JournalInterrupted({
  retry,
  reset,
}: Readonly<{
  retry?: () => void;
  reset?: () => void;
}>) {
  const recover = retry ?? reset;
  const shell = useJournalShell();
  if (shell) return <InPlaceJournalError recover={recover} />;

  return (
    <main className="app-shell journal-error-shell">
      <section className="phone-stage" aria-label="Family journal">
        <header className="topbar journal-error-topbar">
          <span className="family-mark" aria-hidden="true">
            <span className="family-mark-dot dot-teal">O</span>
          </span>
          <div className="title-lockup">
            <span className="eyebrow">Our family</span>
            <h1 id="journal-error-title">Our Days</h1>
          </div>
          <span className="quiet-button" aria-hidden="true" />
        </header>
        <section
          className="timeline journal-error-timeline"
          aria-labelledby="journal-error-title"
        >
          <div className="time-rail" aria-hidden="true" />
          <div className="date-marker">
            <span>Still here</span>
          </div>
          <div className="timeline-empty-state" role="alert">
            <strong>Something interrupted the story</strong>
            <span>We couldn’t open the journal just now.</span>
            {recover ? (
              <button className="retry-button" onClick={recover}>
                Try again
              </button>
            ) : null}
            <a className="journal-error-back" href="/family">
              Back to Family
            </a>
          </div>
        </section>
      </section>
    </main>
  );
}

export function JournalOpenUnavailable({
  retry,
  reset,
}: Readonly<{
  retry?: () => void;
  reset?: () => void;
}>) {
  const recover = retry ?? reset;
  const shell = useJournalShell();
  if (shell) return <InPlaceJournalError recover={recover} />;

  return (
    <main className="app-shell journal-error-shell">
      <section className="phone-stage" aria-label="Family journal">
        <header className="topbar journal-error-topbar">
          <span className="family-mark" aria-hidden="true">
            <span className="family-mark-dot dot-teal">O</span>
          </span>
          <div className="title-lockup">
            <span className="eyebrow">Our family</span>
            <h1 id="journal-unavailable-title">Our Days</h1>
          </div>
          <span className="quiet-button" aria-hidden="true" />
        </header>
        <section
          className="timeline journal-error-timeline"
          aria-labelledby="journal-unavailable-title"
        >
          <div className="time-rail" aria-hidden="true" />
          <div className="date-marker">
            <span>Still here</span>
          </div>
          <div className="timeline-empty-state" role="alert">
            <strong>These days couldn’t open</strong>
            <span>Try again in a moment. Nothing here was lost.</span>
            {recover ? (
              <button className="retry-button" type="button" onClick={recover}>
                Try again
              </button>
            ) : null}
            <a className="journal-error-back" href="/sign-in">
              Sign in again
            </a>
          </div>
        </section>
      </section>
    </main>
  );
}

export function JournalRefreshInterrupted() {
  const router = useRouter();
  return <JournalInterrupted retry={() => router.refresh()} />;
}

export function JournalPanelInterrupted({
  children,
  message,
}: Readonly<{ children?: ReactNode; message: string }>) {
  const router = useRouter();

  return (
    <section className="family-settings-panel">
      <div className="timeline-empty-state" role="alert">
        <strong>These days couldn’t open</strong>
        <span>{message}</span>
        <button
          className="retry-button"
          type="button"
          onClick={() => router.refresh()}
        >
          Try again
        </button>
        <a className="journal-error-back" href="/family">
          Back to Family
        </a>
      </div>
      {children}
    </section>
  );
}

export function AccountPanelInterrupted({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return (
    <JournalPanelInterrupted message="We couldn’t open Account just now.">
      {children}
    </JournalPanelInterrupted>
  );
}
