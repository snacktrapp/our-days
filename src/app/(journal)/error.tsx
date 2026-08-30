"use client";

export default function JournalError({
  reset,
}: Readonly<{ reset: () => void }>) {
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
            <button className="retry-button" onClick={reset}>
              Try again
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
