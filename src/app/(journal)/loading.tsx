import { PrimaryNavigation } from "@/features/shell/primary-navigation";

export default function JournalLoading() {
  return (
    <main className="app-shell" aria-label="Loading family journal">
      <section className="phone-stage journal-loading-shell">
        <div className="journal-loading">
          <span className="loading-rail" aria-hidden="true" />
          <p>Opening your family’s days…</p>
        </div>
        <PrimaryNavigation section="timeline" />
      </section>
    </main>
  );
}
