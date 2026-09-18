import { allHomeLabel, journalSwitcherTypeLabel } from "./journal-switcher";
import { SettingsLink } from "./settings-link";
import { JournalHomeLink } from "./journal-home-link";
import { RoutePendingSkeleton } from "./journal-pending-route";
import { NavSymbol } from "./nav-symbol";

export function OpeningJournalShell() {
  return (
    <>
      <header className="topbar">
        <SettingsLink />
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
          <RoutePendingSkeleton kind="timeline" />
        </section>
      </main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <JournalHomeLink className="nav-item active" aria-current="page">
          <NavSymbol name="family" />
          <span>Journal</span>
        </JournalHomeLink>
        <span className="nav-item">
          <NavSymbol name="add" />
          <span>Add</span>
        </span>
        <a className="nav-item" href="/circles">
          <NavSymbol name="circles" />
          <span>Circles</span>
        </a>
      </nav>
    </>
  );
}
