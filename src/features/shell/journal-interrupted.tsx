"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function JournalInterrupted({
  retry,
  reset,
}: Readonly<{
  retry?: () => void;
  reset?: () => void;
}>) {
  const recover = retry ?? reset;

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

export function JournalRefreshInterrupted() {
  const router = useRouter();
  return <JournalInterrupted retry={() => router.refresh()} />;
}

export function AccountPanelInterrupted({
  children,
}: Readonly<{ children?: ReactNode }>) {
  const router = useRouter();

  return (
    <section className="family-settings-panel">
      <div className="timeline-empty-state" role="alert">
        <strong>Something interrupted the story</strong>
        <span>We couldn’t open Account just now.</span>
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
