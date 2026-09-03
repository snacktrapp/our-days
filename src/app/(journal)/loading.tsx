export default function JournalLoading() {
  return (
    <main className="app-shell" aria-label="Loading family journal">
      <section className="phone-stage journal-loading-shell">
        <div className="journal-loading">
          <span className="loading-rail" aria-hidden="true" />
          <div className="date-marker">
            <span>Opening your family’s days…</span>
          </div>
        </div>
      </section>
    </main>
  );
}
