"use client";

export default function JournalError({
  reset,
}: Readonly<{ reset: () => void }>) {
  return (
    <main className="private-entry-shell">
      <section
        className="private-entry-card"
        aria-labelledby="journal-error-title"
      >
        <span className="private-entry-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <p>Something interrupted the story</p>
        <h1 id="journal-error-title">We couldn’t open the journal.</h1>
        <button className="retry-button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
