import { redirect } from "next/navigation";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { readJournalAccessState } from "@/lib/auth/journal-access";

export default async function AccessUnavailablePage() {
  const access = await readJournalAccessState();
  if (access.mode === "anonymous") redirect("/sign-in");
  if (access.mode === "preview") redirect("/family");
  if (access.mode === "authenticated") redirect("/family");

  return (
    <main className="app-shell journal-error-shell">
      <section className="phone-stage" aria-label="Private family journal">
        <header className="topbar journal-error-topbar">
          <span className="family-mark" aria-hidden="true">
            <span className="family-mark-dot dot-teal">O</span>
          </span>
          <div className="title-lockup">
            <span className="eyebrow">Private family journal</span>
            <h1 id="access-unavailable-title">Our Days</h1>
          </div>
          <span className="quiet-button" aria-hidden="true" />
        </header>
        <section
          className="timeline journal-error-timeline"
          aria-labelledby="access-unavailable-title"
        >
          <div className="time-rail" aria-hidden="true" />
          <div className="date-marker">
            <span>Private boundary</span>
          </div>
          <div className="timeline-empty-state" role="alert">
            <strong>This account does not have family access</strong>
            <span>
              Ask a family organizer for a current invitation if you should have
              access.
            </span>
            <SignOutButton />
          </div>
        </section>
      </section>
    </main>
  );
}
