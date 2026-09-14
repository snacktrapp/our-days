import { allHomeLabel, journalSwitcherTypeLabel } from "./journal-switcher";

export function OpeningJournalShell() {
  return (
    <>
      <header className="topbar">
        <span className="topbar-leading-spacer" aria-hidden="true" />
        <div className="title-lockup">
          <span className="eyebrow">{journalSwitcherTypeLabel("all")}</span>
          <span className="title-switcher-heading">
            <h1 id="journal-focus-target" tabIndex={-1}>
              {allHomeLabel}
            </h1>
          </span>
        </div>
        <div className="topbar-actions" />
      </header>
      <main className="app-shell theme-slate">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />
        <section className="phone-stage" aria-label="Family journal">
          <p
            id="journal-live-region"
            className="sr-only"
            aria-live="assertive"
            aria-atomic="true"
          />
          <section
            className="timeline route-pending-skeleton"
            aria-busy="true"
            aria-label="Opening this journal"
          >
            <div className="time-rail" aria-hidden="true" />
            <div className="route-pending-card" />
            <div className="route-pending-card" />
            <div className="route-pending-card is-short" />
          </section>
        </section>
      </main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <a className="nav-item active" href="/family" aria-current="page">
          <span className="nav-symbol" aria-hidden="true" />
          <span>Journal</span>
        </a>
        <span className="nav-item">
          <span className="nav-symbol" aria-hidden="true" />
          <span>Add</span>
        </span>
        <a className="nav-item" href="/settings/family">
          <span className="nav-symbol" aria-hidden="true" />
          <span>Account</span>
        </a>
      </nav>
    </>
  );
}
